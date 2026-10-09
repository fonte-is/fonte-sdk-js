import assert from "node:assert/strict";
import test from "node:test";
import { createFonte } from "../packages/core/dist/results.js";

const at = "2026-10-06T10:00:00.000Z", originalClock = Date.parse(at), day = 86400000;
const installationId = "app_recovery", serverKey = "synthetic-native-recovery-source-key";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = { id: "original-user", email: "original@example.test", emailVerified: true };
const action = { eventId: uuid(2), occurredAt: new Date(originalClock + 300000).toISOString() };
function fixture(t, days, reply) {
  const now = originalClock + days * day, received = new Map(), requests = [];
  let available = false;
  const value = createFonte({ installationId, serverKey, now: () => now, flushDelayMs: 1000,
    maxRetries: 0, fetch: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      if (!available) return Response.json({}, { status: 503 });
      if (reply) return reply(body, now);
      const records = body.records.map(record => {
        const prior = received.get(record.eventId), canonical = JSON.stringify(record);
        if (prior !== undefined) assert.equal(prior, canonical);
        received.set(record.eventId, canonical);
        return { eventId: record.eventId, outcome: prior === undefined ? "stored" : "replayed" };
      });
      return Response.json({ schema: "fonte.application.receipt.v2", sourceId: installationId,
        acceptedAt: new Date(now).toISOString(), records, delivery: "best_effort" },
      { headers: { "x-fonte-source-revision": "8" } });
    } });
  t.after(() => value.close());
  const identity = value.identify(user, { measurementAllowed: true, eventId: uuid(1), occurredAt: at });
  return { value, identity, received, requests, available: () => { available = true; } };
}

for (const days of [13, 20, 30]) test(`native recovery after ${days} days preserves the original committed fact and requires its exact ACK`, async t => {
  const f = fixture(t, days); assert.ok(f.identity);
  assert.equal(f.identity.browserIdentity, null);
  assert.equal(f.identity.trigger("report_saved", action), false);
  assert.equal((await f.value.flush()).acknowledged, 0);
  assert.equal(f.identity.trigger("report_saved", action), false);
  f.available(); assert.equal((await f.value.flush()).acknowledged, 1);
  assert.equal(f.identity.trigger("report_saved", action), true);
  assert.equal(f.identity.trigger("report_saved", action), true);
  assert.equal(f.value.status().enqueued, 2);
  assert.equal((await f.value.flush()).acknowledged, 2);
  assert.equal(f.identity.trigger("report_saved", action), true);
  assert.equal((await f.value.flush()).replayed, 1);
  assert.equal(f.received.size, 2);
  const stored = JSON.parse(f.received.get(uuid(2)));
  assert.deepEqual(stored, { kind: "trigger", ...action, userId: user.id,
    identityEventId: uuid(1), trigger: "report_saved", successful: true });
  assert.equal(f.identity.trigger("report_saved"), false);
  assert.equal(f.identity.trigger("report_saved", { eventId: uuid(3) }), false);
  assert.equal(f.identity.trigger("report_saved", { occurredAt: action.occurredAt }), false);
  assert.equal(f.identity.trigger("report_saved", { eventId: uuid(3), occurredAt: new Date(originalClock + days * day).toISOString() }), false);
  assert.equal(f.identity.trigger("report_saved", { ...action, occurredAt: "2026-10-06T09:59:59.999Z" }), false);
  assert.equal(f.identity.trigger("report_saved", { ...action, occurredAt: "2026-10-06T10:15:00.000Z" }), false);
  assert.equal(f.identity.returned(action), false);
  assert.equal(f.identity.confirmTrigger("report_saved", { ...action,
    occurredAt: new Date(originalClock + days * day).toISOString() }), null);
  assert.equal(f.value.status().queued, 0);
});

test("lost, denied, erased, foreign or revisionless identity ACKs cannot authorize late server replay", async t => {
  const good = (body, now, change = {}, headers = {}) => Response.json({ schema: "fonte.application.receipt.v2",
    sourceId: installationId, acceptedAt: new Date(now).toISOString(),
    records: body.records.map(({ eventId }) => ({ eventId, outcome: "stored" })), delivery: "best_effort", ...change },
  { headers: { "x-fonte-source-revision": "8", ...headers } });
  const variants = [
    () => { throw new Error("controlled network loss"); },
    () => Response.json({}, { status: 403 }),
    (body, now) => good(body, now, { records: body.records.map(({ eventId }) => ({ eventId, outcome: "erased" })) }),
    (body, now) => good(body, now, { sourceId: "app_foreign" }),
    (body, now) => { const response = good(body, now); response.headers.delete("x-fonte-source-revision"); return response; },
  ];
  for (const reply of variants) {
    const f = fixture(t, 20, reply); assert.ok(f.identity); f.available(); await f.value.flush();
    assert.equal(f.identity.trigger("report_saved", action), false);
    assert.equal(f.requests.every(body => body.records.every(record => record.kind === "identify")), true);
  }
});

test("original identity outside the canonical30-day bound and denied permission withhold late recovery", t => {
  const expired = fixture(t, 30 + 1 / day); assert.equal(expired.identity, null);
  assert.equal(expired.value.status().enqueued, 0);
  const current = fixture(t, 20);
  assert.equal(current.value.identify(user, { measurementAllowed: false, eventId: uuid(3), occurredAt: at }), null);
  assert.equal(current.value.status().enqueued, 1);
  assert.equal(current.value.status().denied, 1);
});
