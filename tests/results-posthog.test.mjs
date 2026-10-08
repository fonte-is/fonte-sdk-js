import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createFonte } from "../packages/core/dist/results.js";

const at = "2026-10-06T10:00:00.000Z", now = Date.parse(at);
const installationId = "app_controlled", serverKey = "synthetic-posthog-source-key-32-bytes";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const options = { projectId: "123", event: "Report saved", sourceRevision: 3, eventId: uuid(2), occurredAt: "2026-10-06T10:05:00.000Z" };
function acknowledged(body, revision = "3", changes = {}, headers = {}) {
  return Response.json({ schema: "fonte.application.receipt.v2", sourceId: installationId,
    acceptedAt: at, records: body.records.map(({ eventId }) => ({ eventId, outcome: "stored" })),
    delivery: "best_effort", ...changes }, { headers: { "x-fonte-source-revision": revision, ...headers } });
}
const claims = capture => JSON.parse(Buffer.from(capture.properties.fonte_commit.split(".")[0], "base64url").toString("utf8"));
function client(t, extra = {}) {
  const requests = [];
  const value = createFonte({ installationId, serverKey, now: () => now + 300000, flushDelayMs: 1000,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      return acknowledged(body);
    }, ...extra });
  t.after(() => value.close());
  return { value, requests, identity: value.identify({ id: "original-user", email: "original@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(1), occurredAt: at }) };
}

test("after-commit PostHog metadata signs the existing native operation with the existing installation credential", async t => {
  const { identity, value, requests } = client(t);
  assert.equal(identity.postHogTrigger("report_saved", options), null);
  assert.equal((await value.flush()).acknowledged, 1);
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

test("wrong input, missing original operation, expiry and closed measurement fail without throwing into product actions", async t => {
  const { identity, value } = client(t);
  await value.flush();
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

test("request-local handles keep parallel signed users and their original identity witnesses separate", async t => {
  const { value, identity } = client(t);
  const other = value.identify({ id: "another-user", email: "other@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(3), occurredAt: at });
  await value.flush();
  const own = identity.postHogTrigger("report_saved", options);
  const second = other.postHogTrigger("report_saved", { ...options, eventId: uuid(4) });
  for (const [capture, userId, identityEventId] of [[own, "original-user", uuid(1)], [second, "another-user", uuid(3)]]) {
    const claim = JSON.parse(Buffer.from(capture.properties.fonte_commit.split(".")[0], "base64url").toString("utf8"));
    assert.equal(claim.record.userId, userId); assert.equal(claim.record.identityEventId, identityEventId);
  }
});

test("the next identity ACK refreshes settings revision without an app configuration edit", async t => {
  let revision = "3";
  const { value, identity } = client(t, { fetch: async (_url, init) => acknowledged(JSON.parse(init.body), revision) });
  await value.flush();
  const { sourceRevision: _manual, ...automatic } = options;
  const original = identity.postHogTrigger("report_saved", automatic);
  assert.equal(claims(original).sourceRevision, 3);
  revision = "4";
  const next = value.identify({ id: "original-user", email: "original@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(3), occurredAt: at });
  assert.equal(next.postHogTrigger("report_saved", automatic), null);
  await value.flush();
  assert.equal(next.postHogTrigger("report_saved", options), null);
  const renewed = next.postHogTrigger("report_saved", { ...automatic, eventId: uuid(4) });
  assert.equal(claims(renewed).sourceRevision, 4);
  assert.equal(claims(renewed).record.identityEventId, uuid(3));
  assert.deepEqual(identity.postHogTrigger("report_saved", automatic), original);
  assert.equal(value.status().requests, 2);
});

test("unavailable, lost, foreign, erased or invalid revision ACKs never qualify a proof", async t => {
  const variants = [
    () => Response.json({}, { status: 503, headers: { "x-fonte-source-revision": "3" } }),
    body => acknowledged(body, "3", { sourceId: "foreign-source" }),
    body => acknowledged(body, "3", { records: [{ eventId: uuid(99), outcome: "stored" }] }),
    body => acknowledged(body, "3", { records: body.records.map(({ eventId }) => ({ eventId, outcome: "erased" })) }),
    body => acknowledged(body, "3", { extra: true }),
    body => acknowledged(body, "3", { acceptedAt: "invalid" }),
    () => new Response("{", { headers: { "x-fonte-source-revision": "3" } }),
    ...["", "0", "03", "3.0", "3, 4", "9007199254740992"].map(revision => body => acknowledged(body, revision)),
    body => { const response = acknowledged(body); response.headers.delete("x-fonte-source-revision"); return response; },
  ];
  for (const reply of variants) {
    const { value, identity } = client(t, { maxRetries: 0, fetch: async (_url, init) => reply(JSON.parse(init.body)) });
    assert.equal(identity.postHogTrigger("report_saved", options), null);
    await value.flush();
    assert.equal(identity.postHogTrigger("report_saved", options), null);
  }
});

test("an unavailable identity can recover its exact queued ACK without replacing its witness or action clock", async t => {
  let available = false;
  const { value, identity } = client(t, { maxRetries: 0, fetch: async (_url, init) => available
    ? acknowledged(JSON.parse(init.body)) : Response.json({}, { status: 503 }) });
  assert.equal((await value.flush()).acknowledged, 0);
  assert.equal(identity.postHogTrigger("report_saved", options), null);
  available = true;
  assert.equal((await value.flush()).acknowledged, 1);
  const capture = identity.postHogTrigger("report_saved", options);
  assert.equal(claims(capture).record.identityEventId, uuid(1));
  assert.equal(claims(capture).record.occurredAt, options.occurredAt);
});

test("reordered receipts qualify only their own non-erased identity and pending delivery never blocks a committed action", async t => {
  let finish;
  const { value, identity } = client(t, { fetch: async (_url, init) => new Promise(resolve => {
    finish = () => resolve(acknowledged(JSON.parse(init.body), "3", { records: [
      { eventId: uuid(3), outcome: "erased" }, { eventId: uuid(1), outcome: "replayed" },
    ] }));
  }) });
  const other = value.identify({ id: "another-user", email: "other@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(3), occurredAt: at });
  const flushing = value.flush();
  await new Promise(resolve => setImmediate(resolve));
  let committed = false;
  const successfulAction = () => { committed = true; return "saved"; };
  assert.equal(successfulAction(), "saved"); assert.equal(committed, true);
  assert.equal(identity.postHogTrigger("report_saved", options), null);
  finish(); await flushing;
  assert.equal(claims(identity.postHogTrigger("report_saved", options)).record.identityEventId, uuid(1));
  assert.equal(other.postHogTrigger("report_saved", { ...options, eventId: uuid(4) }), null);
  assert.equal(value.status().replayed, 1); assert.equal(value.status().erased, 1);
  assert.equal(value.status().requests, 1);
});
