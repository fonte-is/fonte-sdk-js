import assert from "node:assert/strict";
import test from "node:test";
import { createFonte } from "../packages/core/dist/results.js";

const at = "2026-10-08T10:00:00.000Z", now = Date.parse(at);
const installationId = "app_controlled", serverKey = "synthetic-posthog-source-key-32-bytes";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { projectId: "123", event: "Report saved", eventId: uuid(2), occurredAt: "2026-10-08T10:05:00.000Z" };
function receipt(body, outcome = "stored", revision = "3") {
  return Response.json({ schema: "fonte.application.receipt.v2", sourceId: installationId, acceptedAt: at,
    records: body.records.map(({ eventId }) => ({ eventId, outcome })), delivery: "best_effort" },
  { headers: { "x-fonte-source-revision": revision } });
}
function setup(t, overrides = {}) {
  const records = [];
  const fonte = createFonte({ installationId, serverKey, now: () => now + 300000, flushDelayMs: 1000,
    maxRetries: 0, fetch: async (_url, init) => {
      const body = JSON.parse(init.body); records.push(...body.records);
      return receipt(body);
    }, ...overrides });
  t.after(() => fonte.close());
  const identity = fonte.identify({ id: "controlled-user", email: "controlled@example.test", emailVerified: true },
    { measurementAllowed: true, eventId: uuid(1), occurredAt: at });
  assert.ok(identity); return { fonte, identity, records };
}
const claims = witness => JSON.parse(Buffer.from(witness.fonte_commit.split(".")[0], "base64url").toString("utf8"));

test("witness attaches to unchanged existing capture and emits no duplicate native Action", async t => {
  const { fonte, identity, records } = setup(t);
  const original = Object.freeze({ event: input.event, uuid: input.eventId, distinctId: "controlled-user",
    timestamp: new Date(input.occurredAt), properties: Object.freeze({ reportKind: "controlled", count: 1 }) });
  assert.equal(identity.postHogWitness("report_saved", input), null);
  assert.equal((await fonte.flush()).acknowledged, 1);
  const witness = identity.postHogWitness("report_saved", input); assert.ok(witness);
  assert.deepEqual(Object.keys(witness), ["fonte_commit"]); assert.ok(Object.isFrozen(witness));
  assert.deepEqual(witness, identity.postHogTrigger("report_saved", input).properties);
  const captures = [], existingPostHog = { capture: value => captures.push(value) };
  existingPostHog.capture({ ...original, properties: { ...original.properties, ...witness } });
  const captured = captures[0];
  assert.equal(captured.event, original.event); assert.equal(captured.uuid, original.uuid);
  assert.equal(captured.distinctId, original.distinctId); assert.equal(captured.timestamp, original.timestamp);
  assert.deepEqual({ reportKind: captured.properties.reportKind, count: captured.properties.count }, original.properties);
  assert.deepEqual(claims(witness).record, { kind: "trigger", eventId: original.uuid, occurredAt: input.occurredAt,
    userId: original.distinctId, identityEventId: uuid(1), trigger: "report_saved", successful: true });
  assert.equal((await fonte.flush()).acknowledged, 1);
  assert.deepEqual(records.map(record => record.kind), ["identify"]);
  assert.ok(!JSON.stringify(witness).includes(serverKey));
  assert.ok(!JSON.stringify(claims(witness)).includes("@"));
});

test("missing, erased and lost ACK withholds witness while original provider capture remains available", async t => {
  for (const response of [body => receipt(body, "erased"), () => Response.json({}, { status: 503 }),
    () => { throw new Error("controlled_lost_ACK"); }]) {
    const { fonte, identity } = setup(t, { fetch: async (_url, init) => response(JSON.parse(init.body)) });
    await fonte.flush();
    const witness = identity.postHogWitness("report_saved", input); assert.equal(witness, null);
    const original = { event: input.event, uuid: input.eventId, distinctId: "controlled-user", properties: { original: true } };
    const captured = { ...original, properties: { ...original.properties, ...(witness ?? {}) } };
    assert.deepEqual(captured, original); assert.equal(Object.hasOwn(captured.properties, "fonte_commit"), false);
  }
});

test("witness shares original user/window/revision gates and cannot create a current action after expiry", async t => {
  let clock = now + 300000;
  const { fonte, identity } = setup(t, { now: () => clock });
  await fonte.flush();
  assert.equal(claims(identity.postHogWitness("report_saved", input)).sourceRevision, 3);
  for (const changes of [{ userId: "forwarded-user" }, { successful: true }, { sourceRevision: 4 },
    { eventId: undefined }, { occurredAt: "2026-10-08T09:59:59.999Z" }, { occurredAt: "2026-10-08T10:15:00.000Z" }]) {
    assert.equal(identity.postHogWitness("report_saved", { ...input, ...changes }), null);
  }
  clock = now + 900000;
  assert.equal(identity.postHogWitness("report_saved", input), null);
  assert.equal(identity.postHogTrigger("report_saved", input), null);
  fonte.close(); assert.equal(identity.postHogWitness("report_saved", input), null);
});

test("a pending witness ACK never makes a committed product response wait for provider measurement", async t => {
  let release;
  const { fonte, identity } = setup(t, { fetch: async (_url, init) => new Promise(resolve => {
    release = () => resolve(receipt(JSON.parse(init.body)));
  }) });
  const flushing = fonte.flush(); await new Promise(resolve => setImmediate(resolve));
  const committedResponse = { success: true, operationId: input.eventId, committedAt: input.occurredAt };
  assert.equal(committedResponse.success, true);
  assert.equal(identity.postHogWitness("report_saved", input), null);
  release(); await flushing;
  assert.equal(claims(identity.postHogWitness("report_saved", input)).record.occurredAt, committedResponse.committedAt);
});
