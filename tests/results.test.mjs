import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import test from "node:test";
import ts from "typescript";
import { createFonte } from "../packages/core/dist/results.js";
import { createFonteApplicationSource } from "../packages/core/dist/application.js";

const at = "2026-10-06T10:00:00.000Z",
  time = Date.parse(at);
const installationId = "installation-example",
  serverKey = "synthetic-only-native-key-123456789";
const user = {
  id: "app-user-1",
  email: "controlled@example.test",
  emailVerified: true,
};
const eventId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const permission = { measurementAllowed: true };
const identifyOptions = (n = 1, extra = {}) => ({
  ...permission,
  eventId: eventId(n),
  occurredAt: at,
  ...extra,
});
const receipt = (body, outcome = "stored", extra = {}) => ({
  schema: "fonte.application.receipt.v2",
  sourceId: body.sourceId,
  acceptedAt: at,
  records: body.records.map(({ eventId }) => ({ eventId, outcome })),
  delivery: "best_effort",
  ...extra,
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function client(t, extra = {}) {
  const value = createFonte({
    installationId,
    serverKey,
    now: () => time,
    flushDelayMs: 1000,
    retryBaseMs: 1,
    fetch: async (_url, init) => Response.json(receipt(JSON.parse(init.body))),
    ...extra,
  });
  t.after(() => value.close());
  return value;
}
const claims = (handle) =>
  JSON.parse(
    Buffer.from(
      handle.browserIdentity.identityToken.split(".")[0],
      "base64url",
    ).toString("utf8"),
  );

test("extracted transport preserves v1 rejection of a BOM-prefixed uncertain ACK", async (t) => {
  let good = false;
  const bodies = [];
  const value = createFonteApplicationSource({
    siteId: "site_0123456789abcdef0123456789abcdef",
    sourceId: installationId,
    serverKey,
    origin: "https://app.example.test",
    policyVersion: "app-v1",
    now: () => time,
    maxRetries: 0,
    fetch: async (_url, init) => {
      bodies.push(init.body);
      const body = JSON.parse(init.body),
        r = receipt(body, "replayed", {
          schema: "fonte.application.receipt.v1",
        });
      return new Response((good ? "" : "\uFEFF") + JSON.stringify(r), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  t.after(() => value.close());
  assert(
    value.recordAccess(
      { userId: "legacy-user", eventId: eventId(1), occurredAt: at },
      { activity: "granted", identityLink: "granted" },
    ),
  );
  const uncertain = await value.flush();
  assert.equal(uncertain.lastReason, "receipt_unconfirmed");
  assert.equal(uncertain.queued, 1);
  assert.equal(uncertain.acknowledged, 0);
  good = true;
  assert.equal((await value.flush()).replayed, 1);
  assert.equal(bodies[0], bodies[1]);
});

test("extracted v1 configuration retains inherited and non-enumerable known options", async (t) => {
  const requests = [];
  const options = Object.create({
    sourceId: installationId,
    serverKey,
    origin: "https://app.example.test",
    policyVersion: "app-v1",
    now: () => time,
    fetch: async (_url, init) => {
      requests.push(init);
      return Response.json(
        receipt(JSON.parse(init.body), "stored", {
          schema: "fonte.application.receipt.v1",
        }),
      );
    },
  });
  Object.defineProperty(options, "siteId", {
    value: "site_0123456789abcdef0123456789abcdef",
  });
  const value = createFonteApplicationSource(options);
  t.after(() => value.close());
  assert(
    value.recordAccess(
      { userId: "legacy-user" },
      { activity: "granted", identityLink: "granted" },
    ),
  );
  assert.equal((await value.flush()).acknowledged, 1);
  assert.equal(requests[0].headers.Origin, "https://app.example.test");
});

test("native constructor captures one installation and one credential value for transport and signing", async (t) => {
  let reads = 0;
  const requests = [];
  const configuration = {
    installationId,
    now: () => time,
    flushDelayMs: 1000,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ body, headers: init.headers });
      return Response.json(receipt(body));
    },
  };
  Object.defineProperty(configuration, "serverKey", {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      return reads === 1 ? serverKey : "different-synthetic-key-123456789";
    },
  });
  const value = createFonte(configuration);
  t.after(() => value.close());
  assert.equal(reads, 1);
  configuration.installationId = "changed-installation";
  const handle = value.identify(user, {
    ...permission,
    eventId: "11111111-1111-4111-8111-111111111111",
    occurredAt: at,
  });
  assert.equal(handle.browserIdentity.installationId, installationId);
  assert.equal(
    handle.browserIdentity.identityToken.split(".")[1],
    "_4rAVGwjYio9wikFT4y3Z6HEG1ep9aqM3Z0Ze0UMrOE",
  );
  await value.flush();
  assert.equal(reads, 1);
  assert.equal(requests[0].body.sourceId, installationId);
  assert.equal(requests[0].headers["x-fonte-installation-key"], serverKey);
});

test("native server entry and conditional exports add only the frozen facade", async () => {
  assert.deepEqual(Object.keys(await import("@fonte-is/core/results")), [
    "createFonte",
  ]);
  assert.deepEqual(
    Object.keys(await import("@fonte-is/core/results-browser")),
    ["recordFonteReturn"],
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("../packages/core/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.exports["./results"], {
    types: "./dist/results.d.ts",
    node: "./dist/results.js",
  });
  assert.deepEqual(manifest.exports["./results-browser"], {
    types: "./dist/results-browser.d.ts",
    import: "./dist/results-browser.js",
    default: "./dist/results-browser.js",
  });
  assert.deepEqual(manifest.typesVersions["*"].results, [
    "./dist/results.d.ts",
  ]);
  assert.deepEqual(manifest.typesVersions["*"]["results-browser"], [
    "./dist/results-browser.d.ts",
  ]);
  assert.deepEqual(Object.keys(await import("@fonte-is/core")), [
    "createCapture",
  ]);
});

test("identify, direct Return and three named committed successes emit exact native JSON", async (t) => {
  const requests = [];
  const value = client(t, {
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return Response.json(receipt(JSON.parse(init.body)));
    },
  });
  const handle = value.identify(
    { ...user, email: " CONTROLLED@EXAMPLE.TEST " },
    identifyOptions(),
  );
  assert(handle);
  assert(
    handle.returned({
      eventId: eventId(2),
      occurredAt: "2026-10-06T10:00:01Z",
    }),
  );
  for (const [n, key] of [
    [3, "project_created"],
    [4, "report_generated"],
    [5, "invite_sent"],
  ])
    assert(
      handle.trigger(key, {
        eventId: eventId(n),
        occurredAt: `2026-10-06T10:00:0${n - 1}Z`,
      }),
    );
  assert(
    value.retract(
      {
        targetId: eventId(5),
        reason: "correction",
        eventId: eventId(6),
        occurredAt: at,
      },
      permission,
    ),
  );
  assert.equal(requests.length, 0);
  const status = await value.flush();
  assert.equal(status.acknowledged, 6);
  const [{ url, init, body }] = requests;
  assert.equal(url, "https://api.fonte.is/v1/application-observations");
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    "x-fonte-installation-id": installationId,
    "x-fonte-installation-key": serverKey,
  });
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.deepEqual(body.policy, {
    version: "fonte_measurement.v1",
    activity: "granted",
    identityLink: "granted",
  });
  assert.equal(body.schema, "fonte.application.v2");
  assert.equal(body.sourceId, installationId);
  assert.deepEqual(body.records[0], {
    kind: "identify",
    eventId: eventId(1),
    occurredAt: at,
    validUntil: "2026-10-06T10:15:00.000Z",
    user,
  });
  assert.deepEqual(body.records[1], {
    kind: "return",
    eventId: eventId(2),
    occurredAt: "2026-10-06T10:00:01.000Z",
    userId: user.id,
    identityEventId: eventId(1),
    foreground: true,
  });
  assert.deepEqual(
    body.records
      .slice(2, 5)
      .map((r) => [
        r.kind,
        r.trigger,
        r.successful,
        r.userId,
        r.identityEventId,
      ]),
    ["project_created", "report_generated", "invite_sent"].map((key) => [
      "trigger",
      key,
      true,
      user.id,
      eventId(1),
    ]),
  );
  assert.deepEqual(body.records[5], {
    kind: "retract",
    eventId: eventId(6),
    occurredAt: at,
    targetId: eventId(5),
    reason: "correction",
  });
});

test("simultaneous identities retain immutable user and event references without current-user state", async (t) => {
  const records = [],
    value = client(t, {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        records.push(...body.records);
        return Response.json(receipt(body));
      },
    });
  const mutable = { ...user },
    alice = value.identify(mutable, identifyOptions(1));
  const bob = value.identify(
    { id: "app-user-2", email: "second@example.test", emailVerified: false },
    identifyOptions(2),
  );
  mutable.id = "changed-user";
  mutable.email = "changed@example.test";
  mutable.emailVerified = false;
  assert(Object.isFrozen(alice));
  assert(Object.isFrozen(alice.browserIdentity));
  assert(Object.isFrozen(bob));
  assert.throws(() => {
    alice.browserIdentity.userId = "changed-user";
  }, TypeError);
  assert(alice.trigger.call(bob, "project_created", { eventId: eventId(3) }));
  assert(bob.returned({ eventId: eventId(4) }));
  assert(alice.returned({ eventId: eventId(5) }));
  assert.deepEqual(claims(alice).identity.user, user);
  assert.equal(claims(bob).identity.user.emailVerified, false);
  await value.flush();
  assert.deepEqual(
    records.slice(2).map((r) => [r.userId, r.identityEventId]),
    [
      [user.id, eventId(1)],
      ["app-user-2", eventId(2)],
      [user.id, eventId(1)],
    ],
  );
});

test("only explicit true permission reads identity or correction payloads", async (t) => {
  let reads = 0,
    requests = 0;
  const value = client(t, {
    fetch: () => {
      requests++;
      throw Error("must stay unread");
    },
  });
  const secret = new Proxy(
    {},
    {
      get() {
        reads++;
        throw Error(serverKey);
      },
      ownKeys() {
        reads++;
        throw Error(serverKey);
      },
    },
  );
  for (const measurementAllowed of [
    false,
    undefined,
    null,
    "true",
    "granted",
    "unknown",
    1,
  ]) {
    assert.equal(value.identify(secret, { measurementAllowed }), null);
    assert.equal(value.retract(secret, { measurementAllowed }), false);
  }
  const badPermission = new Proxy(
    {},
    {
      get() {
        throw Error(serverKey);
      },
    },
  );
  assert.doesNotThrow(() => {
    assert.equal(value.identify(secret, badPermission), null);
    assert.equal(value.retract(secret, badPermission), false);
  });
  await value.flush();
  assert.equal(reads, 0);
  assert.equal(requests, 0);
  assert.equal(value.status().denied, 16);
});

test("unverified email remains unverified; no Contact, account, money or arbitrary properties are accepted", async (t) => {
  const value = client(t),
    handle = value.identify(
      { ...user, emailVerified: false },
      identifyOptions(),
    );
  assert.equal(claims(handle).identity.user.emailVerified, false);
  for (const extra of [
    { contactId: "contact_1" },
    { accountId: "account_1" },
    { plan: "pro" },
    { properties: {} },
    { payment: { amount: 100 } },
  ]) {
    assert.equal(
      value.identify({ ...user, ...extra }, identifyOptions(2)),
      null,
    );
    assert.equal(handle.trigger("project_created", { ...extra }), false);
    assert.equal(handle.returned({ ...extra }), false);
    assert.equal(
      value.retract(
        { targetId: eventId(1), reason: "withdrawn", ...extra },
        permission,
      ),
      false,
    );
  }
  assert.equal(value.status().enqueued, 1);
});

test("token signing matches an independent fixed SHA-256-key HMAC vector", (t) => {
  const value = client(t),
    handle = value.identify(user, {
      ...permission,
      eventId: "11111111-1111-4111-8111-111111111111",
      occurredAt: at,
    });
  // Literal vector computed independently with Python hashlib/hmac, not the implementation.
  const encoded =
    "eyJzY2hlbWEiOiJmb250ZS5pZGVudGl0eS52MSIsImluc3RhbGxhdGlvbklkIjoiaW5zdGFsbGF0aW9uLWV4YW1wbGUiLCJpZGVudGl0eSI6eyJraW5kIjoiaWRlbnRpZnkiLCJldmVudElkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwib2NjdXJyZWRBdCI6IjIwMjYtMTAtMDZUMTA6MDA6MDAuMDAwWiIsInZhbGlkVW50aWwiOiIyMDI2LTEwLTA2VDEwOjE1OjAwLjAwMFoiLCJ1c2VyIjp7ImlkIjoiYXBwLXVzZXItMSIsImVtYWlsIjoiY29udHJvbGxlZEBleGFtcGxlLnRlc3QiLCJlbWFpbFZlcmlmaWVkIjp0cnVlfX0sIm1lYXN1cmVtZW50QWxsb3dlZCI6dHJ1ZX0";
  assert.equal(
    handle.browserIdentity.identityToken,
    `${encoded}._4rAVGwjYio9wikFT4y3Z6HEG1ep9aqM3Z0Ze0UMrOE`,
  );
  assert.deepEqual(Object.keys(handle.browserIdentity), [
    "installationId",
    "identityToken",
    "userId",
    "identityEventId",
    "validUntil",
  ]);
  assert(!handle.browserIdentity.identityToken.includes(serverKey));
});

test("identity lifetime is at most 15 minutes and activity is bounded by that exact interval", (t) => {
  let now = time;
  const value = client(t, { now: () => now }),
    handle = value.identify(user, identifyOptions());
  assert.equal(
    value.identify(user, identifyOptions(2, { validUntil: at })),
    null,
  );
  assert.equal(
    value.identify(
      user,
      identifyOptions(2, { validUntil: "2026-10-06T10:15:00.001Z" }),
    ),
    null,
  );
  assert.equal(
    handle.returned({ occurredAt: "2026-10-06T09:59:59.999Z" }),
    false,
  );
  assert.equal(
    handle.trigger("project_created", {
      occurredAt: "2026-10-06T10:15:00.000Z",
    }),
    false,
  );
  now = time + 899_999;
  assert(
    handle.trigger("project_created", {
      eventId: eventId(3),
      occurredAt: "2026-10-06T10:14:59.999Z",
    }),
  );
  assert(handle.browserIdentity);
  now++;
  assert.equal(handle.browserIdentity, null);
  assert.equal(
    handle.trigger("project_created", { eventId: eventId(4), occurredAt: at }),
    false,
  );
  assert.equal(handle.returned(), false);
  assert.equal(value.status().enqueued, 2);
});

test("canonical calendar validation precedes identity reads and accepts real leap-day fractions", (t) => {
  for (const [invalid, clock] of [
    ["2026-02-30T10:00:00Z", "2026-03-02T10:00:00Z"],
    ["2025-02-29T10:00:00Z", "2025-03-01T10:00:00Z"],
    ["1900-02-29T10:00:00Z", "1900-03-01T10:00:00Z"],
    ["2026-10-06T24:00:00Z", at],
    ["2026-10-06T10:00:60Z", at],
    ["2026-10-06T10:00:00.1234Z", at],
    ["2026-10-06T10:00:00+00:00", at],
  ]) {
    let reads = 0;
    const value = client(t, { now: () => Date.parse(clock) }),
      privateUser = new Proxy(
        {},
        {
          get() {
            reads++;
            throw 0;
          },
          ownKeys() {
            reads++;
            throw 0;
          },
        },
      );
    assert.equal(
      value.identify(privateUser, identifyOptions(1, { occurredAt: invalid })),
      null,
      invalid,
    );
    assert.equal(reads, 0, invalid);
  }
  for (const [input, normalized] of [
    ["2024-02-29T10:00:00Z", "2024-02-29T10:00:00.000Z"],
    ["2000-02-29T10:00:00.1Z", "2000-02-29T10:00:00.100Z"],
    ["2024-02-29T10:00:00.12Z", "2024-02-29T10:00:00.120Z"],
    ["2024-02-29T10:00:00.123Z", "2024-02-29T10:00:00.123Z"],
  ]) {
    const value = client(t, { now: () => Date.parse(input) });
    assert.equal(
      claims(value.identify(user, identifyOptions(1, { occurredAt: input })))
        .identity.occurredAt,
      normalized,
    );
  }
});

test("historical and future occurrence bounds are literal and do not renew expired identities", (t) => {
  const value = client(t),
    old = new Date(time - 30 * 86_400_000).toISOString();
  const historical = value.identify(
    user,
    identifyOptions(1, { occurredAt: old }),
  );
  assert(historical);
  assert.equal(historical.browserIdentity, null);
  assert.equal(historical.returned(), false);
  assert.equal(
    value.identify(
      user,
      identifyOptions(2, {
        occurredAt: new Date(time - 30 * 86_400_000 - 1).toISOString(),
      }),
    ),
    null,
  );
  assert(
    value.identify(
      user,
      identifyOptions(2, {
        occurredAt: new Date(time + 300_000).toISOString(),
      }),
    ),
  );
  assert.equal(
    value.identify(
      user,
      identifyOptions(3, {
        occurredAt: new Date(time + 300_001).toISOString(),
      }),
    ),
    null,
  );
  assert.equal(
    value.retract(
      {
        targetId: eventId(1),
        reason: "withdrawn",
        eventId: eventId(4),
        occurredAt: new Date(time - 30 * 86_400_000 - 1).toISOString(),
      },
      permission,
    ),
    false,
  );
});

test("strict native IDs, UUIDs, booleans and names reject malformed caller facts without throwing", (t) => {
  const value = client(t),
    handle = value.identify(
      { ...user, id: "a".repeat(200) },
      identifyOptions(),
    );
  assert(handle);
  assert(handle.trigger("a".repeat(64), { eventId: eventId(2) }));
  for (const id of ["", "a".repeat(201), "user email@example.test", "á", null])
    assert.equal(value.identify({ ...user, id }, identifyOptions(3)), null);
  for (const emailVerified of ["true", 1, null, undefined])
    assert.equal(
      value.identify({ ...user, emailVerified }, identifyOptions(3)),
      null,
    );
  for (const key of [
    "",
    "A",
    "1key",
    "with-dash",
    "a".repeat(65),
    null,
    {},
    "report_generated\n",
  ])
    assert.equal(handle.trigger(key), false);
  for (const event of ["invalid", null, "00000000-0000-7000-8000-000000000003"])
    assert.equal(handle.returned({ eventId: event }), false);
  assert.equal(
    value.retract(
      {
        eventId: eventId(4).toUpperCase(),
        targetId: eventId(4),
        reason: "withdrawn",
      },
      permission,
    ),
    false,
  );
  assert.equal(
    value.retract({ targetId: eventId(1), reason: "delete" }, permission),
    false,
  );
  const throwing = new Proxy(
    {},
    {
      get() {
        throw Error(serverKey);
      },
      ownKeys() {
        throw Error(serverKey);
      },
    },
  );
  assert.doesNotThrow(() => {
    assert.equal(value.identify(throwing, permission), null);
    assert.equal(handle.trigger("project_created", throwing), false);
    assert.equal(handle.returned(throwing), false);
    assert.equal(value.retract(throwing, permission), false);
  });
});

test("defaults generate independent original UUIDs and time once before any request", async (t) => {
  const requests = [],
    value = client(t, {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        requests.push(body);
        return Response.json(receipt(body));
      },
    });
  const before = performance.now(),
    first = value.identify(user, permission),
    second = value.identify(user, permission);
  assert(first);
  assert(second);
  assert(first.returned());
  assert(second.trigger("invite_sent"));
  assert.equal(requests.length, 0);
  assert(performance.now() - before < 50);
  const original = claims(first).identity;
  assert.equal(original.occurredAt, at);
  assert.equal(original.validUntil, "2026-10-06T10:15:00.000Z");
  await value.flush();
  assert.equal(new Set(requests[0].records.map((r) => r.eventId)).size, 4);
  assert(requests[0].records.every((r) => r.occurredAt === at));
});

test("lost ACK and committed-operation replay retain identical bytes, UUIDs and original time", async (t) => {
  let now = time,
    calls = 0;
  const bodies = [],
    durable = new Set();
  const value = client(t, {
    now: () => now,
    fetch: async (_url, init) => {
      calls++;
      bodies.push(init.body);
      const body = JSON.parse(init.body),
        replayed = durable.has(body.records[0].eventId);
      body.records.forEach((r) => durable.add(r.eventId));
      now += 1000;
      if (calls === 1) throw Error("lost receipt");
      return Response.json(receipt(body, replayed ? "replayed" : "stored"));
    },
  });
  const handle = value.identify(user, identifyOptions());
  assert(
    handle.trigger("report_generated", { eventId: eventId(2), occurredAt: at }),
  );
  assert(
    handle.trigger("report_generated", { eventId: eventId(2), occurredAt: at }),
  );
  assert.equal(
    handle.trigger("invite_sent", { eventId: eventId(2), occurredAt: at }),
    false,
  );
  assert.equal((await value.flush()).replayed, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(durable.size, 2);
  const same = value.identify(user, identifyOptions());
  assert(
    same.trigger("report_generated", { eventId: eventId(2), occurredAt: at }),
  );
  assert.equal((await value.flush()).replayed, 4);
  assert.equal(bodies[2], bodies[0]);
  assert.equal(durable.size, 2);
});

test("native queue caps 1000 entries and each batch caps 100 records and 64 KiB", async (t) => {
  const batches = [],
    value = client(t, {
      fetch: async (_url, init) => {
        assert(Buffer.byteLength(init.body) <= 65_536);
        const body = JSON.parse(init.body);
        batches.push(body.records.length);
        return Response.json(receipt(body));
      },
    });
  const handle = value.identify(user, identifyOptions());
  for (let n = 2; n <= 1000; n++)
    assert(handle.trigger("project_created", { eventId: eventId(n) }));
  assert.equal(handle.returned({ eventId: eventId(1001) }), false);
  assert.equal(value.status().lastReason, "queue_full");
  assert.equal((await value.flush()).acknowledged, 1000);
  assert.deepEqual(batches, Array(10).fill(100));
  const small = client(t, { queueLimit: 1 });
  assert(small.identify(user, identifyOptions()));
  assert.equal(small.identify(user, identifyOptions(2)), null);
});

test("native byte-bound batches split large normalized identities before 100 records", async (t) => {
  const batches = [],
    value = client(t, {
      fetch: async (_url, init) => {
        assert(Buffer.byteLength(init.body) <= 65_536);
        const body = JSON.parse(init.body);
        batches.push(body.records.length);
        return Response.json(receipt(body));
      },
    });
  for (let n = 1; n <= 100; n++)
    assert(
      value.identify(
        {
          id: "u".repeat(200),
          email: `${"e".repeat(306)}@example.test`,
          emailVerified: true,
        },
        identifyOptions(n),
      ),
    );
  assert.equal((await value.flush()).acknowledged, 100);
  assert.equal(batches.length, 2);
  assert(batches[0] < 100);
});

for (const [name, mutate] of [
  ["wrong source", (r) => ({ ...r, sourceId: "other" })],
  ["v1 schema", (r) => ({ ...r, schema: "fonte.application.receipt.v1" })],
  ["missing record", (r) => ({ ...r, records: [] })],
  [
    "unknown outcome",
    (r) => ({
      ...r,
      records: [{ eventId: r.records[0].eventId, outcome: "accepted" }],
    }),
  ],
  ["duplicate IDs", (r) => ({ ...r, records: [r.records[0], r.records[0]] })],
  [
    "impossible timestamp",
    (r) => ({ ...r, acceptedAt: "2026-02-30T10:00:00Z" }),
  ],
  ["unknown extra data", (r) => ({ ...r, email: user.email })],
  ["durability claim", (r) => ({ ...r, delivery: "complete" })],
])
  test(`native malformed ACK ${name} retains the queue until exact receipt`, async (t) => {
    let good = false;
    const bodies = [];
    const value = client(t, {
      maxRetries: 0,
      fetch: async (_url, init) => {
        bodies.push(init.body);
        const r = receipt(JSON.parse(init.body), "replayed");
        return Response.json(good ? r : mutate(r));
      },
    });
    const handle = value.identify(user, identifyOptions());
    assert(handle);
    assert(handle.returned({ eventId: eventId(2) }));
    const uncertain = await value.flush();
    assert.equal(uncertain.acknowledged, 0);
    assert.equal(uncertain.queued, 2);
    assert.equal(uncertain.lastReason, "receipt_unconfirmed");
    good = true;
    assert.equal((await value.flush()).replayed, 2);
    assert.equal(bodies[0], bodies[1]);
  });

for (const status of [403, 409])
  test(`native permanent ${status} closes delivery without failing committed work`, async (t) => {
    const value = client(t, {
        fetch: async () => new Response(null, { status }),
      }),
      handle = value.identify(user, identifyOptions());
    let commits = 0;
    const save = () => {
      const committed = { id: ++commits };
      handle.trigger("project_created");
      return committed;
    };
    assert.deepEqual(save(), { id: 1 });
    const result = await value.flush();
    assert.equal(result.state, "blocked");
    assert.equal(result.dropped, 2);
    assert.equal(handle.browserIdentity, null);
    assert.doesNotThrow(() => assert.deepEqual(save(), { id: 2 }));
    assert.equal(value.identify(user, permission), null);
    assert.equal(
      result.lastReason,
      status === 403 ? "source_denied" : "source_conflict",
    );
  });

test("native source outages and timeout recovery never throw or expose identity, token or key", async (t) => {
  for (const failure of ["throw", "reject", "stall"]) {
    let online = false;
    const bodies = [];
    const value = client(t, {
      timeoutMs: 15,
      maxRetries: 0,
      fetch: (_url, init) => {
        bodies.push(init.body);
        if (online)
          return Promise.resolve(
            Response.json(receipt(JSON.parse(init.body), "replayed")),
          );
        if (failure === "throw") throw Error(`${serverKey}:${user.email}`);
        if (failure === "reject")
          return Promise.reject(Error(`${serverKey}:${user.email}`));
        return new Promise(() => {});
      },
    });
    const handle = value.identify(user, identifyOptions());
    assert(handle.trigger("report_generated", { eventId: eventId(2) }));
    const token = handle.browserIdentity.identityToken;
    await assert.doesNotReject(value.flush());
    const result = value.status();
    assert.equal(result.state, "disconnected");
    assert.equal(result.queued, 2);
    const json = JSON.stringify(result);
    assert(!json.includes(serverKey));
    assert(!json.includes(user.email));
    assert(!json.includes(token));
    online = true;
    assert.equal((await value.flush()).replayed, 2);
    assert.equal(bodies[0], bodies[1]);
  }
});

test("native retries stay bounded and closing aborts and wakes the shared delivery loop", async (t) => {
  let calls = 0;
  const value = client(t, {
    fetch: async () => {
      calls++;
      return new Response(null, { status: 503 });
    },
  });
  assert(value.identify(user, identifyOptions()));
  const result = await value.flush();
  assert.equal(calls, 4);
  assert.equal(result.retries, 3);
  assert.equal(result.queued, 1);
  let signal;
  const stalled = client(t, {
    fetch: (_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  const handle = stalled.identify(user, identifyOptions()),
    active = stalled.flush();
  await delay(0);
  assert.equal(stalled.flush(), active);
  assert.equal(stalled.close().dropped, 1);
  assert(signal.aborted);
  assert.equal((await active).state, "closed");
  assert.equal(handle.returned(), false);
  assert.equal(handle.browserIdentity, null);
  assert.equal((await stalled.flush()).state, "closed");
  assert.deepEqual(stalled.close(), stalled.status());
});

test("native clients are independent while concurrent flushes serialize each client", async (t) => {
  let active = 0,
    maximum = 0,
    release;
  const observed = [];
  const value = client(t, {
    fetch: async (_url, init) => {
      active++;
      maximum = Math.max(maximum, active);
      observed.push(JSON.parse(init.body));
      if (observed.length === 1)
        await new Promise((done) => {
          release = done;
        });
      active--;
      return Response.json(receipt(observed.at(-1)));
    },
  });
  const independent = client(t, {
    installationId: "installation-other",
    queueLimit: 1,
  });
  const handle = value.identify(user, identifyOptions()),
    pending = value.flush();
  assert.equal(value.flush(), pending);
  await delay(0);
  assert(handle.returned({ eventId: eventId(2) }));
  assert(
    independent.identify({ ...user, id: "second-user" }, identifyOptions(3)),
  );
  assert.equal((await independent.flush()).acknowledged, 1);
  assert.equal(value.status().acknowledged, 0);
  release();
  assert.equal((await pending).acknowledged, 1);
  assert.equal((await value.flush()).acknowledged, 2);
  assert.equal(maximum, 1);
});

test("native actual loopback HTTP repeats one immutable batch after a lost receipt", async (t) => {
  const requests = [],
    stored = new Set();
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    const raw = Buffer.concat(parts).toString("utf8"),
      body = JSON.parse(raw),
      replayed = stored.has(body.records[0].eventId);
    body.records.forEach((r) => stored.add(r.eventId));
    requests.push({ raw, path: request.url, headers: request.headers });
    if (requests.length === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify(receipt(body, replayed ? "replayed" : "stored")),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const value = client(t, {
    apiOrigin: `http://127.0.0.1:${server.address().port}`,
    allowInsecureLocalhost: true,
    fetch: globalThis.fetch,
  });
  const handle = value.identify(user, identifyOptions());
  assert(handle.trigger("project_created", { eventId: eventId(2) }));
  assert.equal((await value.flush()).replayed, 2);
  assert.equal(stored.size, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].raw, requests[1].raw);
  for (const request of requests) {
    assert.equal(request.path, "/v1/application-observations");
    assert.equal(request.headers.origin, undefined);
    assert.equal(request.headers["x-fonte-installation-id"], installationId);
    assert.equal(request.headers["x-fonte-installation-key"], serverKey);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
  }
});

test("invalid native construction and server-only use expose only constant errors", () => {
  const base = { installationId, serverKey };
  for (const bad of [
    null,
    undefined,
    { ...base, installationId: "" },
    { ...base, serverKey: `${serverKey}\nprivate` },
    { ...base, apiOrigin: `https://user:${serverKey}@api.example.test` },
    { ...base, apiOrigin: "http://evil.example.test" },
    { ...base, apiOrigin: "https://api.example.test/path" },
    { ...base, queueLimit: 1001 },
    { ...base, batchSize: 101 },
    { ...base, timeoutMs: 751 },
    { ...base, maxRetries: 4 },
    { ...base, now: "bad" },
    { ...base, fetch: "bad" },
    { ...base, workspaceId: "caller-authority" },
  ]) {
    assert.throws(() => createFonte(bad), {
      message: "fonte_results_configuration_invalid",
    });
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  try {
    assert.throws(() => createFonte(base), {
      message: "fonte_results_server_only",
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});

test("strict built type consumer permits confirmed success and rejects provider options, old aliases and browser authority", () => {
  const file = new URL("./native-types-consumer.ts", import.meta.url).pathname;
  const fixture = `import {createFonte, type AuthenticatedAppUser, type FonteIdentityHandle} from '@fonte-is/core/results';
import {recordFonteReturn, type FonteBrowserIdentity} from '@fonte-is/core/results-browser';
export function use(user: AuthenticatedAppUser, handle: FonteIdentityHandle, browser: FonteBrowserIdentity) {
  const fonte = createFonte({installationId: 'synthetic-installation', serverKey: 'synthetic-only-native-key-123456789'});
  fonte.identify(user, {measurementAllowed: true}); handle.trigger('project_created', {eventId: 'original', occurredAt: 'original'});
  handle.returned(); fonte.retract({targetId: 'original', reason: 'correction'}, {measurementAllowed: true}); recordFonteReturn(browser);
  const confirmation: string | null = handle.confirmTrigger('project_created', {eventId: 'original', occurredAt: 'original', sourceRevision: 1});
  void confirmation;
  // @ts-expect-error confirmation requires an explicit original UUID and time
  handle.confirmTrigger('project_created', {});
  // @ts-expect-error provider capture options are not generic action facts
  handle.confirmTrigger('project_created', {eventId: 'original', occurredAt: 'original', projectId: '123', event: 'Project created'});
  // @ts-expect-error actor claims belong to the original authenticated identity
  handle.confirmTrigger('project_created', {eventId: 'original', occurredAt: 'original', userId: 'caller'});
  // @ts-expect-error unpublished provider-specific helper is removed, not aliased
  handle.postHogWitness('project_created', {eventId: 'original', occurredAt: 'original'});
  // @ts-expect-error browser cannot supply authoritative success
  recordFonteReturn(browser, {trigger: 'project_created'});
  // @ts-expect-error no generic properties or Contact graph
  handle.trigger('project_created', {contactId: 'caller', properties: {}});
  // @ts-expect-error no raw native enqueue API
  fonte.enqueue({kind: 'trigger'});
}`;
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    exactOptionalPropertyTypes: true,
    skipLibCheck: true,
    baseUrl: new URL("..", import.meta.url).pathname,
    paths: {
      "@fonte-is/core/results": ["packages/core/dist/results.d.ts"],
      "@fonte-is/core/results-browser": [
        "packages/core/dist/results-browser.d.ts",
      ],
    },
  };
  const host = ts.createCompilerHost(options),
    oldGet = host.getSourceFile.bind(host),
    oldExists = host.fileExists.bind(host),
    oldRead = host.readFile.bind(host);
  host.getSourceFile = (name, language, error, create) =>
    name === file
      ? ts.createSourceFile(name, fixture, language, true)
      : oldGet(name, language, error, create);
  host.fileExists = (name) => name === file || oldExists(name);
  host.readFile = (name) => (name === file ? fixture : oldRead(name));
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram([file], options, host),
  );
  assert.deepEqual(
    diagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    ),
    [],
  );
});
