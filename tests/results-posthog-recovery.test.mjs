import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createFonte } from "../packages/core/dist/results.js";

const observedAt = "2026-10-06T10:00:00.000Z", originalClock = Date.parse(observedAt), day = 86400000;
const installationId = "app_original_recovery", serverKey = "synthetic-original-posthog-recovery-key";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = { id: "original-user", email: "original@example.test", emailVerified: true };
const original = Object.freeze({ projectId: "123", event: "Report saved", eventId: uuid(2),
  occurredAt: new Date(originalClock + 300000).toISOString() });
function response(body, now, revision = "8", change = {}) {
  return Response.json({ schema: "fonte.application.receipt.v2", sourceId: installationId,
    acceptedAt: new Date(now).toISOString(), records: body.records.map(({ eventId }) => ({ eventId, outcome: "stored" })),
    delivery: "best_effort", ...change }, { headers: { "x-fonte-source-revision": revision } });
}
function fixture(t, days, { reply, key = serverKey } = {}) {
  let now = originalClock + days * day, available = false;
  const records = [];
  const value = createFonte({ installationId, serverKey: key, now: () => now, maxRetries: 0,
    flushDelayMs: 1000, fetch: async (_url, init) => {
      const body = JSON.parse(init.body); records.push(...body.records);
      return available ? (reply ? reply(body, now) : response(body, now)) : Response.json({}, { status: 503 });
    } });
  t.after(() => value.close());
  const identity = value.identify(user, { measurementAllowed: true, eventId: uuid(1), occurredAt: observedAt });
  return { value, identity, records, available: () => { available = true; }, clock: value => { now = value; } };
}
function verifiedClaims(witness, key = serverKey) {
  const [encoded, signature] = witness.fonte_commit.split(".");
  assert.equal(signature, createHmac("sha256", createHash("sha256").update(key).digest()).update(encoded).digest("base64url"));
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

for (const days of [13, 20, 30]) test(`PostHog original-fact recovery at ${days} days requires the exact ACK and preserves provider identity/time`, async t => {
  const f = fixture(t, days); assert.ok(f.identity);
  assert.equal(f.identity.browserIdentity, null);
  assert.equal(f.identity.postHogWitness("report_saved", original), null);
  assert.equal((await f.value.flush()).acknowledged, 0);
  assert.equal(f.identity.postHogWitness("report_saved", original), null);
  f.available(); assert.equal((await f.value.flush()).acknowledged, 1);
  const witness = f.identity.postHogWitness("report_saved", original); assert.ok(witness);
  assert.deepEqual(verifiedClaims(witness), { schema: "fonte.posthog.commit.v1", sourceId: installationId,
    sourceRevision: 8, projectId: original.projectId, event: original.event, record: {
      kind: "trigger", eventId: original.eventId, occurredAt: original.occurredAt, userId: user.id,
      identityEventId: uuid(1), trigger: "report_saved", successful: true,
    } });
  assert.deepEqual(f.identity.postHogWitness("report_saved", original), witness);
  const capture = f.identity.postHogTrigger("report_saved", original);
  assert.equal(capture.event, original.event); assert.equal(capture.uuid, original.eventId);
  assert.equal(capture.distinctId, user.id); assert.equal(capture.timestamp.toISOString(), original.occurredAt);
  assert.deepEqual(capture.properties, witness);
  assert.equal((await f.value.flush()).acknowledged, 1);
  assert.equal(f.value.status().enqueued, 1);
  assert.equal(f.records.every(record => record.kind === "identify"), true);
  assert.equal(f.identity.returned({ eventId: uuid(3), occurredAt: original.occurredAt }), false);
  assert.equal(f.identity.trigger("report_saved"), false);
  assert.equal(f.identity.postHogWitness("report_saved", { ...original, eventId: uuid(3),
    occurredAt: new Date(originalClock + days * day).toISOString() }), null);
});

test("late proof denies missing clocks, changed actor claims and actions outside the original witness", async t => {
  const f = fixture(t, 20); f.available(); await f.value.flush();
  for (const changes of [
    { eventId: undefined }, { occurredAt: undefined }, { eventId: "invented-provider-id" },
    { occurredAt: "2026-10-06T09:59:59.999Z" }, { occurredAt: "2026-10-06T10:15:00.000Z" },
    { userId: "wrong-user" }, { identityEventId: uuid(9) }, { successful: true }, { sourceRevision: 7 },
    { occurredAt: new Date(originalClock + 20 * day).toISOString() },
  ]) assert.equal(f.identity.postHogWitness("report_saved", { ...original, ...changes }), null);
  assert.equal(f.identity.postHogWitness("report_saved", {}), null);
  assert.equal(f.identity.postHogWitness("report_saved", null), null);
  assert.equal(f.value.status().enqueued, 1);
  assert.ok(f.identity.postHogWitness("report_saved", { ...original, occurredAt: observedAt }));
  assert.ok(f.identity.postHogWitness("report_saved", { ...original, occurredAt: "2026-10-06T10:14:59.999Z" }));
});

test("lost, denied, erased, foreign and revisionless ACKs cannot grant late provider proof", async t => {
  const variants = [
    () => { throw new Error("controlled_lost_ACK"); },
    () => Response.json({}, { status: 403 }),
    (body, now) => response(body, now, "8", { records: body.records.map(({ eventId }) => ({ eventId, outcome: "erased" })) }),
    (body, now) => response(body, now, "8", { sourceId: "app_wrong_source" }),
    (body, now) => response(body, now, "8", { records: [{ eventId: uuid(9), outcome: "stored" }] }),
    (body, now) => { const result = response(body, now); result.headers.delete("x-fonte-source-revision"); return result; },
  ];
  for (const reply of variants) {
    const f = fixture(t, 20, { reply }); f.available(); await f.value.flush();
    assert.equal(f.identity.postHogWitness("report_saved", original), null);
    assert.equal(f.records.every(record => record.kind === "identify"), true);
  }
});

test("restart replays the exact original identity at the current ACK revision and Source key", async t => {
  const first = fixture(t, 0); first.clock(originalClock + 300000); first.available(); await first.value.flush();
  const old = first.identity.postHogWitness("report_saved", original); assert.ok(old); first.value.close();
  const key = "synthetic-rotated-original-recovery-key";
  const restarted = fixture(t, 20, { key, reply: (body, now) => response(body, now, "9", {
    records: body.records.map(({ eventId }) => ({ eventId, outcome: "replayed" })),
  }) });
  assert.equal(restarted.identity.postHogWitness("report_saved", original), null);
  restarted.available(); assert.equal((await restarted.value.flush()).replayed, 1);
  const recovered = restarted.identity.postHogWitness("report_saved", original); assert.ok(recovered);
  const currentClaims = verifiedClaims(recovered, key), oldClaims = verifiedClaims(old);
  assert.equal(currentClaims.sourceRevision, 9); assert.equal(oldClaims.sourceRevision, 8);
  assert.deepEqual(currentClaims.record, oldClaims.record);
  assert.notEqual(recovered.fonte_commit, old.fonte_commit);
  assert.equal(restarted.identity.postHogWitness("report_saved", { ...original, sourceRevision: 8 }), null);
  assert.deepEqual(restarted.records[0], first.records[0]);
  restarted.value.close(); assert.equal(restarted.identity.postHogWitness("report_saved", original), null);
});

test("canonical thirty-day limit and current permission denial do not renew original authority", async t => {
  const expired = fixture(t, 30 + 1 / day); assert.equal(expired.identity, null);
  assert.equal(expired.value.status().enqueued, 0);
  const f = fixture(t, 30); f.available(); await f.value.flush();
  assert.ok(f.identity.postHogWitness("report_saved", original));
  f.clock(Date.parse(original.occurredAt) + 30 * day + 1);
  assert.equal(f.identity.postHogWitness("report_saved", original), null);
  assert.equal(f.identity.browserIdentity, null);
  assert.equal(f.value.identify(user, { measurementAllowed: false, eventId: uuid(9), occurredAt: observedAt }), null);
  assert.equal(f.identity.postHogWitness("report_saved", original), null);
  assert.equal(f.value.status().enqueued, 1);
});
