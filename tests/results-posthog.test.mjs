import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createFonte } from "../packages/core/dist/results.js";

const at = "2026-10-06T10:00:00.000Z", now = Date.parse(at);
const installationId = "app_controlled", serverKey = "synthetic-posthog-source-key-32-bytes";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const options = { projectId: "123", event: "Report saved", sourceRevision: 3, eventId: uuid(2), occurredAt: "2026-10-06T10:05:00.000Z" };
function client(t, extra = {}) {
  const requests = [];
  const value = createFonte({ installationId, serverKey, now: () => now + 300000, flushDelayMs: 1000,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      return Response.json({ schema: "fonte.application.receipt.v2", sourceId: installationId,
        acceptedAt: at, records: body.records.map(({ eventId }) => ({ eventId, outcome: "stored" })), delivery: "best_effort" });
    }, ...extra });
  t.after(() => value.close());
  return { value, requests, identity: value.identify({ id: "original-user", email: "original@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(1), occurredAt: at }) };
}

test("after-commit PostHog metadata signs the existing native operation with the existing installation credential", async t => {
  const { identity, value, requests } = client(t);
  const capture = identity.postHogTrigger("report_saved", options);
  assert(capture);
  assert.deepEqual(Object.keys(capture), ["event", "uuid", "distinctId", "timestamp", "properties"]);
  assert.equal(capture.uuid, uuid(2)); assert.equal(capture.distinctId, "original-user");
  assert.equal(capture.timestamp.toISOString(), options.occurredAt);
  assert(Object.isFrozen(capture)); assert(Object.isFrozen(capture.properties));
  const [encoded, signature] = capture.properties.fonte_commit.split(".");
  const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.deepEqual(claims, { schema: "fonte.posthog.commit.v1", sourceId: installationId, sourceRevision: 3,
    projectId: "123", event: "Report saved", record: { kind: "trigger", eventId: uuid(2), occurredAt: options.occurredAt,
      userId: "original-user", identityEventId: uuid(1), trigger: "report_saved", successful: true } });
  const signingKey = createHash("sha256").update(serverKey).digest();
  assert.equal(signature, createHmac("sha256", signingKey).update(encoded).digest("base64url"));
  assert(!JSON.stringify(claims).includes("@")); assert(!JSON.stringify(capture).includes(serverKey));
  assert.deepEqual(identity.postHogTrigger("report_saved", options), capture);
  assert.equal((await value.flush()).acknowledged, 1);
  assert.deepEqual(requests.flatMap(body => body.records.map(record => record.kind)), ["identify"]);
});

test("wrong input, missing original operation, expiry and closed measurement fail without throwing into product actions", t => {
  const { identity, value } = client(t);
  for (const extra of [{ projectId: "0" }, { sourceRevision: 0 }, { sourceRevision: "3" }, { event: " Report saved" },
    { event: "Report saved\n" }, { eventId: undefined }, { occurredAt: undefined },
    { occurredAt: "2026-10-06T09:59:59.999Z" }, { occurredAt: "2026-10-06T10:15:00.000Z" },
    { successful: true }, { userId: "another-user" }, { identityEventId: uuid(99) }])
    assert.equal(identity.postHogTrigger("report_saved", { ...options, ...extra }), null);
  assert.equal(identity.postHogTrigger("Invalid", options), null);
  value.close(); assert.equal(identity.postHogTrigger("report_saved", options), null);
  let clock = now;
  const expiring = client(t, { now: () => clock });
  clock += 900000;
  assert.equal(expiring.identity.postHogTrigger("report_saved", options), null);
});

test("request-local handles keep parallel signed users and their original identity witnesses separate", t => {
  const { value, identity } = client(t);
  const other = value.identify({ id: "another-user", email: "other@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(3), occurredAt: at });
  const own = identity.postHogTrigger("report_saved", options);
  const second = other.postHogTrigger("report_saved", { ...options, eventId: uuid(4) });
  for (const [capture, userId, identityEventId] of [[own, "original-user", uuid(1)], [second, "another-user", uuid(3)]]) {
    const claim = JSON.parse(Buffer.from(capture.properties.fonte_commit.split(".")[0], "base64url").toString("utf8"));
    assert.equal(claim.record.userId, userId); assert.equal(claim.record.identityEventId, identityEventId);
  }
});
