import assert from "node:assert/strict";
import test from "node:test";
import { createFonte } from "../packages/core/dist/results.js";

const at = "2026-10-08T10:00:00.000Z",
  now = Date.parse(at);
const installationId = "app_controlled",
  serverKey = "synthetic-trigger-source-key-32-bytes";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { eventId: uuid(2), occurredAt: "2026-10-08T10:05:00.000Z" };
function receipt(body, outcome = "stored", revision = "3") {
  return Response.json(
    {
      schema: "fonte.application.receipt.v2",
      sourceId: installationId,
      acceptedAt: at,
      records: body.records.map(({ eventId }) => ({ eventId, outcome })),
      delivery: "best_effort",
    },
    { headers: { "x-fonte-source-revision": revision } },
  );
}
function setup(t, overrides = {}) {
  const records = [];
  const fonte = createFonte({
    installationId,
    serverKey,
    now: () => now + 300000,
    flushDelayMs: 1000,
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      records.push(...body.records);
      return receipt(body);
    },
    ...overrides,
  });
  t.after(() => fonte.close());
  const user = {
    id: "controlled-user",
    email: "controlled@example.test",
    emailVerified: true,
  };
  const identity = fonte.identify(user, {
    measurementAllowed: true,
    eventId: uuid(1),
    occurredAt: at,
  });
  assert.ok(identity);
  return { fonte, identity, records, user };
}
const claims = (confirmation) =>
  JSON.parse(
    Buffer.from(confirmation.split(".")[0], "base64url").toString("utf8"),
  );

test("one opaque confirmation fits different server metadata carriers without changing their original operation", async (t) => {
  const { fonte, identity, records } = setup(t);
  assert.equal(identity.confirmTrigger("report_saved", input), null);
  await fonte.flush();
  const confirmation = identity.confirmTrigger("report_saved", input);
  assert.equal(typeof confirmation, "string");
  const original = Object.freeze({
    name: "Report saved",
    id: input.eventId,
    actorId: "controlled-user",
    savedAt: input.occurredAt,
    properties: Object.freeze({ reportKind: "controlled", count: 1 }),
  });
  const carriers = [
    { operation: original, metadata: { actionConfirmation: confirmation } },
    { body: original, headers: { "x-action-confirmation": confirmation } },
    { message: original, attributes: { confirmation } },
  ];
  for (const carrier of carriers) {
    const decoded = JSON.parse(JSON.stringify(carrier));
    assert.deepEqual(
      decoded.operation ?? decoded.body ?? decoded.message,
      original,
    );
    const carried =
      decoded.metadata?.actionConfirmation ??
      decoded.headers?.["x-action-confirmation"] ??
      decoded.attributes?.confirmation;
    assert.equal(carried, confirmation);
    assert.deepEqual(claims(carried).record, {
      kind: "trigger",
      eventId: original.id,
      occurredAt: original.savedAt,
      userId: original.actorId,
      identityEventId: uuid(1),
      trigger: "report_saved",
      successful: true,
    });
  }
  assert.deepEqual(Object.keys(claims(confirmation)), [
    "schema",
    "sourceId",
    "sourceRevision",
    "record",
  ]);
  assert.equal((await fonte.flush()).acknowledged, 1);
  assert.deepEqual(
    records.map((record) => record.kind),
    ["identify"],
  );
  assert.ok(!confirmation.includes(serverKey));
  assert.ok(!JSON.stringify(claims(confirmation)).includes("@"));
});

test("missing, erased and lost identity ACKs provide no confirmation or extra delivery", async (t) => {
  for (const response of [
    (body) => receipt(body, "erased"),
    () => Response.json({}, { status: 503 }),
    () => {
      throw new Error("controlled_lost_ACK");
    },
  ]) {
    const { fonte, identity } = setup(t, {
      fetch: async (_url, init) => response(JSON.parse(init.body)),
    });
    await fonte.flush();
    assert.equal(identity.confirmTrigger("report_saved", input), null);
    assert.equal(fonte.status().enqueued, 1);
  }
});

test("confirmation retains the verified actor snapshot", async (t) => {
  const { fonte, identity, user } = setup(t);
  user.id = "changed-user";
  user.email = "changed@example.test";
  user.emailVerified = false;
  await fonte.flush();
  assert.equal(
    claims(identity.confirmTrigger("report_saved", input)).record.userId,
    "controlled-user",
  );
  assert.deepEqual(Object.keys(identity), [
    "trigger",
    "confirmTrigger",
    "returned",
    "browserIdentity",
  ]);
  for (const extra of [
    { userId: "wrong-user" },
    { identityEventId: uuid(9) },
    { successful: false },
    { kind: "retract" },
    { targetId: input.eventId },
    { record: {} },
    { confirmation: "untrusted" },
  ])
    assert.equal(
      identity.confirmTrigger("report_saved", { ...input, ...extra }),
      null,
    );
});

test("denied measurement never reads claimed identity or permits confirmation", async (t) => {
  const { fonte } = setup(t);
  let reads = 0;
  const deniedUser = new Proxy(
    {},
    {
      get() {
        reads++;
        throw Error("must_not_read");
      },
    },
  );
  assert.equal(fonte.identify(deniedUser, { measurementAllowed: false }), null);
  assert.equal(reads, 0);
  assert.equal(fonte.status().enqueued, 1);
});

test("confirmation adds no Action alongside an explicit original native delivery or authoritative retraction", async (t) => {
  const { fonte, identity, records } = setup(t);
  await fonte.flush();
  const confirmation = identity.confirmTrigger("report_saved", input);
  assert.ok(confirmation);
  assert.equal(identity.trigger("report_saved", input), true);
  assert.equal(identity.confirmTrigger("report_saved", input), confirmation);
  assert.equal(
    fonte.retract(
      {
        targetId: input.eventId,
        reason: "withdrawn",
        eventId: uuid(3),
        occurredAt: input.occurredAt,
      },
      { measurementAllowed: true },
    ),
    true,
  );
  await fonte.flush();
  assert.deepEqual(
    records.map((record) => record.kind),
    ["identify", "trigger", "retract"],
  );
  assert.equal(records.filter((record) => record.kind === "trigger").length, 1);
  assert.equal(fonte.status().enqueued, 3);
});

test("a pending identity ACK cannot turn confirmation into awaited business work", async (t) => {
  let release;
  const { fonte, identity } = setup(t, {
    fetch: async (_url, init) =>
      new Promise((resolve) => {
        release = () => resolve(receipt(JSON.parse(init.body)));
      }),
  });
  const flushing = fonte.flush();
  await new Promise((resolve) => setImmediate(resolve));
  const committedResponse = {
    success: true,
    operationId: input.eventId,
    committedAt: input.occurredAt,
  };
  assert.equal(committedResponse.success, true);
  assert.equal(identity.confirmTrigger("report_saved", input), null);
  release();
  await flushing;
  assert.equal(
    claims(identity.confirmTrigger("report_saved", input)).record.occurredAt,
    committedResponse.committedAt,
  );
});
