import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { createFonteApplicationSource } from "../packages/core/dist/application.js";

const at = "2026-10-05T12:00:00.000Z";
const siteId = "site_0123456789abcdef0123456789abcdef";
const sourceId = "application_reference_1";
const origin = "https://app.example.test";
const serverKey = "synthetic-only-application-key-123456789";
const granted = { activity: "granted", identityLink: "granted" };
const eventId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record = (n, extra = {}) => ({
  kind: "action",
  eventId: eventId(n),
  occurredAt: at,
  userId: "user_1",
  accountId: "account_1",
  actor: "user",
  action: "report_saved",
  successful: true,
  ...extra,
});
const receipt = (body, outcome = "stored", extra = {}) => ({
  schema: "fonte.application.receipt.v1",
  sourceId: body.sourceId,
  acceptedAt: at,
  records: body.records.map(({ eventId }) => ({ eventId, outcome })),
  delivery: "best_effort",
  ...extra,
});
function client(t, extra = {}) {
  const value = createFonteApplicationSource({
    siteId,
    sourceId,
    serverKey,
    origin,
    policyVersion: "app-v1",
    now: () => Date.parse(at),
    retryBaseMs: 1,
    fetch: async (_url, init) => Response.json(receipt(JSON.parse(init.body))),
    ...extra,
  });
  t.after(() => value.close());
  return value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("business hooks return before any Fonte request, including during an outage", async (t) => {
  let calls = 0;
  const value = client(t, {
    maxRetries: 0,
    timeoutMs: 20,
    fetch: (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(Error("offline")), {
          once: true,
        }),
      );
    },
  });
  const before = performance.now();
  const businessResult = { committed: true, reportId: "report_1" };
  assert.equal(
    value.recordAction(
      {
        userId: "user_1",
        accountId: "account_1",
        action: "report_saved",
        successful: true,
      },
      granted,
    ),
    true,
  );
  assert.equal(calls, 0);
  assert.equal(businessResult.committed, true);
  assert(
    performance.now() - before < 50,
    "one in-memory hook exceeded the local 50 ms containment threshold",
  );
  const status = await value.flush();
  assert.equal(status.state, "disconnected");
  assert.equal(status.lastReason, "request_timeout");
  assert.equal(status.queued, 1);
});

test("denied and unknown permissions avoid reading the record or sending a request", async (t) => {
  let reads = 0,
    calls = 0;
  const value = client(t, {
    fetch: () => {
      calls++;
      throw Error("must not be called");
    },
  });
  const privateRecord = new Proxy(
    {},
    {
      get() {
        reads++;
        throw Error("private");
      },
      ownKeys() {
        reads++;
        throw Error("private");
      },
    },
  );
  for (const activity of ["granted", "denied", "unknown"])
    for (const identityLink of ["granted", "denied", "unknown"]) {
      if (activity === "granted" && identityLink === "granted") continue;
      const permission = { activity, identityLink };
      assert.equal(value.recordAction(privateRecord, permission), false);
      assert.equal(value.enqueue(privateRecord, permission), false);
    }
  await value.flush();
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  assert.equal(value.status().denied, 16);
});

test("all hooks emit the fixed server contract without browser scope or client plan ranks", async (t) => {
  const requests = [];
  const value = client(t, {
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, init, body });
      return Response.json(receipt(body));
    },
  });
  assert(
    value.recordAccess({ eventId: eventId(1), userId: "user_1" }, granted),
  );
  assert(
    value.recordAction(
      {
        eventId: eventId(2),
        userId: "user_1",
        action: "report_saved",
        successful: true,
      },
      granted,
    ),
  );
  assert(
    value.recordRelationship(
      {
        eventId: eventId(3),
        userId: "user_1",
        contactId: "contact_1",
        accountId: "account_1",
        sourcePartyId: eventId(99),
        validFrom: "2026-10-01T00:00:00Z",
        state: "verified",
      },
      granted,
    ),
  );
  assert(
    value.recordUpgrade(
      {
        eventId: eventId(4),
        accountId: "account_1",
        previousPlan: "free",
        effectivePlan: "pro",
        state: "effective",
        priorStateVerified: true,
      },
      granted,
    ),
  );
  assert(
    value.retract(
      { eventId: eventId(5), targetId: eventId(4), reason: "correction" },
      granted,
    ),
  );
  const status = await value.flush();
  assert.equal(status.acknowledged, 5);
  assert.equal(requests.length, 1);
  const [{ url, init, body }] = requests;
  assert.equal(
    url,
    `https://api.fonte.is/v1/websites/${siteId}/application-observations`,
  );
  assert.deepEqual(init.headers, {
    "Content-Type": "application/json",
    Origin: origin,
    "x-fonte-installation-id": sourceId,
    "x-fonte-installation-key": serverKey,
  });
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.deepEqual(Object.keys(body), [
    "schema",
    "sourceId",
    "policy",
    "records",
  ]);
  assert.deepEqual(body.policy, {
    version: "app-v1",
    activity: "granted",
    identityLink: "granted",
  });
  assert.equal(body.records[0].actor, "user");
  assert.equal(body.records[0].accountId, null);
  assert.equal(body.records[0].occurredAt, at);
  assert.equal(body.records[2].occurredAt, undefined);
  assert.equal(body.records[2].validFrom, "2026-10-01T00:00:00.000Z");
  assert.equal(body.records[2].validUntil, null);
  assert.equal(body.records[3].previousRank, undefined);
});

test("malformed, private, stale, or authority-bearing additions are rejected before transport", async (t) => {
  let calls = 0;
  const value = client(t, {
    fetch: () => {
      calls++;
      throw Error("must not be called");
    },
  });
  const invalid = [
    record(1, { userId: "person@example.test" }),
    record(1, { email: "person@example.test" }),
    record(1, { workspaceId: "caller_workspace" }),
    record(1, { payment: { amount: 100 } }),
    record(1, { successful: "true" }),
    record(1, { eventId: "not-a-uuid" }),
    record(1, { occurredAt: "2026-09-01T00:00:00Z" }),
    record(1, { occurredAt: "2026-10-05T12:05:00.001Z" }),
    record(1, { actor: "unknown" }),
    record(1, { userId: null }),
    {
      kind: "upgrade",
      eventId: eventId(1),
      occurredAt: at,
      accountId: "account_1",
      previousPlan: "free",
      effectivePlan: "pro",
      previousRank: 0,
      effectiveRank: 1,
      state: "effective",
      priorStateVerified: true,
    },
    {
      kind: "relationship",
      eventId: eventId(1),
      userId: "user_1",
      contactId: "contact_1",
      accountId: null,
      sourcePartyId: null,
      validFrom: at,
      validUntil: at,
      state: "verified",
    },
    {
      kind: "retract",
      eventId: eventId(1),
      occurredAt: at,
      targetId: eventId(1),
      reason: "correction",
    },
  ];
  for (const input of invalid)
    assert.equal(value.enqueue(input, granted), false);
  assert.equal(
    value.recordAccess({ userId: "user_1", secret: "discard me" }, granted),
    false,
  );
  await value.flush();
  assert.equal(calls, 0);
  assert.equal(value.status().queued, 0);
  assert.equal(value.status().rejected, invalid.length + 1);
  assert.equal(value.status().lastReason, "record_invalid");
});

test("invalid UTC calendar timestamps are rejected before identity reads or transport", async (t) => {
  const cases = [
    ["2026-02-30T12:00:00Z", "2026-03-02T12:00:00Z"],
    ["2025-02-29T12:00:00Z", "2025-03-01T12:00:00Z"],
    ["1900-02-29T12:00:00Z", "1900-03-01T12:00:00Z"],
    ["2100-02-29T12:00:00Z", "2100-03-01T12:00:00Z"],
    ["2026-10-05T24:00:00Z", "2026-10-06T00:00:00Z"],
    ["2026-10-05T12:00:60Z", at],
    ["2026-10-05T12:00:00.1234Z", at],
    ["2026-10-05T12:00:00.Z", at],
  ];
  for (const [invalid, current] of cases) {
    let identityReads = 0,
      requests = 0;
    const value = client(t, {
      now: () => Date.parse(current),
      fetch: () => {
        requests++;
        throw Error("invalid timestamps must not send");
      },
    });
    const action = {
      ...record(1),
      occurredAt: invalid,
      get userId() {
        identityReads++;
        return "user_1";
      },
      get accountId() {
        identityReads++;
        return "account_1";
      },
    };
    const relationship = (validFrom, validUntil) => ({
      kind: "relationship",
      eventId: eventId(2),
      get userId() {
        identityReads++;
        return "user_1";
      },
      get contactId() {
        identityReads++;
        return "contact_1";
      },
      get accountId() {
        identityReads++;
        return "account_1";
      },
      get sourcePartyId() {
        identityReads++;
        return null;
      },
      validFrom,
      validUntil,
      state: "verified",
    });
    assert.equal(value.enqueue(action, granted), false, invalid);
    assert.equal(
      value.enqueue(relationship(invalid, null), granted),
      false,
      invalid,
    );
    const before = new Date(Date.parse(current) - 1_000).toISOString();
    assert.equal(
      value.enqueue(relationship(before, invalid), granted),
      false,
      invalid,
    );
    await value.flush();
    assert.equal(identityReads, 0, invalid);
    assert.equal(requests, 0, invalid);
    assert.equal(value.status().enqueued, 0, invalid);
    assert.equal(value.status().queued, 0, invalid);
    assert.equal(value.status().rejected, 3, invalid);
    assert.equal(value.status().lastReason, "record_invalid", invalid);
  }
});

test("valid leap days and zero through three fractional digits normalize without changing the calendar", async (t) => {
  for (const [input, canonical] of [
    ["2024-02-29T12:34:56Z", "2024-02-29T12:34:56.000Z"],
    ["2000-02-29T12:34:56.1Z", "2000-02-29T12:34:56.100Z"],
    ["2024-02-29T12:34:56.12Z", "2024-02-29T12:34:56.120Z"],
    ["2024-02-29T12:34:56.123Z", "2024-02-29T12:34:56.123Z"],
  ]) {
    const bodies = [];
    const value = client(t, {
      now: () => Date.parse(input),
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        return Response.json(receipt(body));
      },
    });
    assert(value.enqueue(record(1, { occurredAt: input }), granted));
    assert(
      value.recordRelationship(
        {
          eventId: eventId(2),
          userId: "user_1",
          contactId: "contact_1",
          validFrom: input,
          validUntil: new Date(Date.parse(input) + 1_000).toISOString(),
          state: "verified",
        },
        granted,
      ),
    );
    assert.equal((await value.flush()).acknowledged, 2);
    assert.equal(bodies[0].records[0].occurredAt, canonical);
    assert.equal(bodies[0].records[1].validFrom, canonical);
    assert.equal(
      bodies[0].records[1].validUntil,
      new Date(Date.parse(canonical) + 1_000).toISOString(),
    );
  }
});

test("thrown, rejected and denied source delivery cannot throw into a committed business operation", async (t) => {
  for (const failure of ["throw", "reject", "deny"]) {
    let calls = 0,
      commits = 0;
    const value = client(t, {
      maxRetries: 0,
      fetch: () => {
        calls++;
        if (failure === "throw")
          throw Error(`${serverKey}: synthetic private diagnostic`);
        if (failure === "reject")
          return Promise.reject(
            Error(`${serverKey}: synthetic private diagnostic`),
          );
        return Promise.resolve(new Response(null, { status: 403 }));
      },
    });
    const save = () => {
      const result = { id: `report_${++commits}`, committed: true };
      value.recordAction(
        { userId: "user_1", action: "report_saved", successful: true },
        granted,
      );
      return result;
    };
    let first;
    assert.doesNotThrow(() => {
      first = save();
    });
    assert.deepEqual(first, { id: "report_1", committed: true });
    assert.equal(calls, 0);
    await assert.doesNotReject(value.flush());
    const after = value.status();
    assert.equal(after.state, failure === "deny" ? "blocked" : "disconnected");
    assert(!JSON.stringify(after).includes(serverKey));
    let second;
    assert.doesNotThrow(() => {
      second = save();
    });
    assert.deepEqual(second, { id: "report_2", committed: true });
    assert.equal(calls, 1);
  }
});

test("a full queue rejects new records and delivers 1,000 intents in bounded batches", async (t) => {
  const bodies = [];
  const value = client(t, {
    fetch: async (_url, init) => {
      assert(Buffer.byteLength(init.body) <= 65_536);
      const body = JSON.parse(init.body);
      assert(body.records.length <= 100);
      bodies.push(body);
      return Response.json(receipt(body));
    },
  });
  for (let n = 1; n <= 1_000; n++)
    assert.equal(value.enqueue(record(n), granted), true);
  assert.equal(value.enqueue(record(1_001), granted), false);
  assert.equal(value.status().queued, 1_000);
  assert.equal(value.status().dropped, 1);
  const status = await value.flush();
  assert.equal(status.acknowledged, 1_000);
  assert.equal(status.queued, 0);
  assert.equal(bodies.length, 10);
  assert.equal(
    new Set(
      bodies.flatMap((body) => body.records.map((record) => record.eventId)),
    ).size,
    1_000,
  );
});

test("byte limits split large valid relationships before the 100-record limit", async (t) => {
  const batches = [];
  const value = client(t, {
    fetch: async (_url, init) => {
      assert(Buffer.byteLength(init.body) <= 65_536);
      const body = JSON.parse(init.body);
      batches.push(body.records.length);
      return Response.json(receipt(body));
    },
  });
  for (let n = 1; n <= 100; n++)
    assert(
      value.recordRelationship(
        {
          eventId: eventId(n),
          userId: "u".repeat(200),
          contactId: "c".repeat(200),
          accountId: "a".repeat(200),
          sourcePartyId: eventId(999),
          validFrom: at,
          state: "verified",
        },
        granted,
      ),
    );
  assert.equal((await value.flush()).acknowledged, 100);
  assert(batches.length > 1);
  assert.equal(
    batches.reduce((sum, count) => sum + count, 0),
    100,
  );
});

test("uncertain ACK retries preserve immutable IDs and payloads; pending duplicates converge", async (t) => {
  const bodies = [];
  const options = {
    siteId,
    sourceId,
    serverKey,
    origin,
    policyVersion: "app-v1",
    now: () => Date.parse(at),
    retryBaseMs: 1,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(init.body);
      return Response.json(
        bodies.length === 1
          ? receipt(body, "stored", { records: [] })
          : receipt(body, "replayed"),
      );
    },
  };
  const value = createFonteApplicationSource(options);
  t.after(() => value.close());
  const input = record(1);
  assert(value.enqueue(input, granted));
  assert(value.enqueue({ ...input }, granted));
  assert.equal(value.enqueue({ ...input, successful: false }, granted), false);
  input.action = "mutated";
  input.eventId = eventId(999);
  options.sourceId = "mutated";
  options.serverKey = "mutated";
  const status = await value.flush();
  assert.equal(status.enqueued, 1);
  assert.equal(status.acknowledged, 1);
  assert.equal(status.replayed, 1);
  assert.equal(status.retries, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[0]).records[0].action, "report_saved");
  assert.equal(JSON.parse(bodies[0]).sourceId, sourceId);
});

for (const [name, alter] of [
  [
    "wrong source",
    (body) => receipt(body, "stored", { sourceId: "other_source" }),
  ],
  ["wrong schema", (body) => receipt(body, "stored", { schema: "other" })],
  ["missing record", (body) => receipt(body, "stored", { records: [] })],
  [
    "extra record",
    (body) =>
      receipt(body, "stored", {
        records: [
          ...receipt(body).records,
          { eventId: eventId(99), outcome: "stored" },
        ],
      }),
  ],
  ["unknown outcome", (body) => receipt(body, "unconfirmed")],
  [
    "missing timestamp",
    (body) => receipt(body, "stored", { acceptedAt: null }),
  ],
  [
    "impossible calendar timestamp",
    (body) => receipt(body, "stored", { acceptedAt: "2026-02-30T12:00:00Z" }),
  ],
  [
    "wrong delivery",
    (body) => receipt(body, "stored", { delivery: "durable" }),
  ],
  [
    "extra response data",
    (body) => receipt(body, "stored", { private: "never expose" }),
  ],
])
  test(`ACK ${name} retains the original record until a valid receipt`, async (t) => {
    let calls = 0;
    const value = client(t, {
      maxRetries: 0,
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        return Response.json(
          ++calls === 1 ? alter(body) : receipt(body, "erased"),
        );
      },
    });
    assert(value.enqueue(record(1), granted));
    const uncertain = await value.flush();
    assert.equal(uncertain.state, "disconnected");
    assert.equal(uncertain.acknowledged, 0);
    assert.equal(uncertain.queued, 1);
    assert.equal(uncertain.lastReason, "receipt_unconfirmed");
    const confirmed = await value.flush();
    assert.equal(confirmed.acknowledged, 1);
    assert.equal(confirmed.erased, 1);
    assert.equal(confirmed.queued, 0);
  });

test("duplicate ACK IDs and oversized responses cannot commit the client queue", async (t) => {
  let calls = 0;
  const value = client(t, {
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls++;
      if (calls === 1)
        return Response.json(
          receipt(body, "stored", {
            records: [receipt(body).records[0], receipt(body).records[0]],
          }),
        );
      if (calls === 2) return new Response("x".repeat(70_000), { status: 200 });
      return Response.json(receipt(body));
    },
  });
  assert(value.enqueue(record(1), granted));
  assert(value.enqueue(record(2), granted));
  assert.equal((await value.flush()).queued, 2);
  assert.equal((await value.flush()).queued, 2);
  assert.equal((await value.flush()).acknowledged, 2);
});

for (const statusCode of [403, 409])
  test(`HTTP ${statusCode} stops this source and counts discarded records`, async (t) => {
    let calls = 0;
    const value = client(t, {
      fetch: async () => {
        calls++;
        return Response.json({ secret: serverKey }, { status: statusCode });
      },
    });
    assert(value.enqueue(record(1), granted));
    assert(value.enqueue(record(2), granted));
    const status = await value.flush();
    assert.equal(status.state, "blocked");
    assert.equal(status.queued, 0);
    assert.equal(status.dropped, 2);
    assert.equal(
      status.lastReason,
      statusCode === 403 ? "source_denied" : "source_conflict",
    );
    assert.equal(value.enqueue(record(3), granted), false);
    await value.flush();
    assert.equal(calls, 1);
    assert(!JSON.stringify(value).includes(serverKey));
    assert(!JSON.stringify(value.status()).includes(serverKey));
    const independent = client(t);
    assert(independent.enqueue(record(1), granted));
    assert.equal((await independent.flush()).acknowledged, 1);
  });

test("transient retries are bounded and a later lifecycle flush can recover", async (t) => {
  const bodies = [];
  const value = client(t, {
    fetch: async (_url, init) => {
      bodies.push(init.body);
      return bodies.length <= 4
        ? new Response(null, { status: 503 })
        : Response.json(receipt(JSON.parse(init.body)));
    },
  });
  assert(value.enqueue(record(1), granted));
  const disconnected = await value.flush();
  assert.equal(disconnected.requests, 4);
  assert.equal(disconnected.retries, 3);
  assert.equal(disconnected.state, "disconnected");
  assert.equal(disconnected.queued, 1);
  assert.equal(new Set(bodies).size, 1);
  await delay(30);
  assert.equal(
    bodies.length,
    4,
    "exhausted retries must not leave a polling loop",
  );
  assert.equal((await value.flush()).acknowledged, 1);
  assert.equal(new Set(bodies).size, 1);
});

test("bounded Retry-After is respected and a long cooldown avoids a hanging flush", async (t) => {
  let time = Date.parse(at),
    calls = 0;
  const value = client(t, {
    now: () => time,
    fetch: async (_url, init) => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 429, headers: { "Retry-After": "5" } })
        : Response.json(receipt(JSON.parse(init.body)));
    },
  });
  assert(value.enqueue(record(1), granted));
  const cooling = await value.flush();
  assert.equal(cooling.lastReason, "retry_later");
  assert.equal(cooling.retryAfterMs, 5_000);
  assert.equal(calls, 1);
  await value.flush();
  assert.equal(calls, 1);
  time += 5_001;
  assert.equal((await value.flush()).acknowledged, 1);
  let started = 0,
    resumed = 0;
  const short = client(t, {
    fetch: async (_url, init) => {
      if (!started) {
        started = performance.now();
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "0.025" },
        });
      }
      resumed = performance.now();
      return Response.json(receipt(JSON.parse(init.body)));
    },
  });
  assert(short.enqueue(record(1), granted));
  await short.flush();
  assert(resumed - started >= 24);
});

test("timeouts abort transport and retry the same intent without exposing thrown diagnostics", async (t) => {
  let online = false;
  const bodies = [],
    signals = [];
  const value = client(t, {
    timeoutMs: 15,
    maxRetries: 1,
    fetch: async (_url, init) => {
      bodies.push(init.body);
      signals.push(init.signal);
      if (online)
        return Response.json(receipt(JSON.parse(init.body), "replayed"));
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          "abort",
          () => reject(Error(`${serverKey}: user private data`)),
          { once: true },
        ),
      );
    },
  });
  assert(value.enqueue(record(1), granted));
  const offline = await value.flush();
  assert.equal(offline.state, "disconnected");
  assert.equal(offline.queued, 1);
  assert.equal(offline.requests, 2);
  assert(signals.every((signal) => signal.aborted));
  assert(!JSON.stringify(offline).includes(serverKey));
  online = true;
  assert.equal((await value.flush()).replayed, 1);
  assert.equal(new Set(bodies).size, 1);
});

test("concurrent flushes share one request loop and new arrivals retain their own turn", async (t) => {
  let resolveFirst,
    active = 0,
    maximum = 0,
    calls = 0;
  const value = client(t, {
    fetch: async (_url, init) => {
      active++;
      maximum = Math.max(maximum, active);
      const body = JSON.parse(init.body);
      calls++;
      if (calls === 1)
        await new Promise((resolve) => {
          resolveFirst = resolve;
        });
      active--;
      return Response.json(receipt(body));
    },
  });
  assert(value.enqueue(record(1), granted));
  const first = value.flush(),
    same = value.flush();
  assert.equal(first, same);
  await delay(0);
  assert.equal(calls, 1);
  assert(value.enqueue(record(2), granted));
  resolveFirst();
  assert.equal((await first).acknowledged, 1);
  assert.equal((await value.flush()).acknowledged, 2);
  assert.equal(maximum, 1);
  assert.equal(calls, 2);
});

test("closing aborts an active request, drops memory and prevents later requests", async (t) => {
  let calls = 0,
    signal;
  const value = client(t, {
    fetch: (_url, init) => {
      calls++;
      signal = init.signal;
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(Error("aborted")), {
          once: true,
        }),
      );
    },
  });
  assert(value.enqueue(record(1), granted));
  const pending = value.flush();
  await delay(0);
  const closed = value.close();
  assert.equal(closed.state, "closed");
  assert.equal(closed.dropped, 1);
  assert.equal(signal.aborted, true);
  assert.equal((await pending).state, "closed");
  assert.equal(value.recordAccess({ userId: "user_1" }, granted), false);
  assert.equal((await value.flush()).state, "closed");
  await delay(30);
  assert.equal(calls, 1);
  assert.deepEqual(value.close(), value.status());
});

test("closing wakes a retry delay without leaving a process-lifecycle wait", async (t) => {
  let calls = 0;
  const value = client(t, {
    retryBaseMs: 1_000,
    fetch: async () => {
      calls++;
      return new Response(null, { status: 503 });
    },
  });
  assert(value.enqueue(record(1), granted));
  const pending = value.flush();
  await delay(0);
  value.close();
  const before = performance.now();
  await pending;
  assert(performance.now() - before < 50);
  assert.equal(calls, 1);
});

test("a stalled ACK body is cancelled on timeout and cannot discard a queued record", async (t) => {
  let cancelled = false,
    online = false;
  const bodies = [];
  const value = client(t, {
    timeoutMs: 15,
    maxRetries: 0,
    fetch: async (_url, init) => {
      bodies.push(init.body);
      if (online)
        return Response.json(receipt(JSON.parse(init.body), "replayed"));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"schema":'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    },
  });
  assert(value.enqueue(record(1), granted));
  const uncertain = await value.flush();
  assert.equal(uncertain.lastReason, "request_timeout");
  assert.equal(uncertain.queued, 1);
  assert.equal(uncertain.acknowledged, 0);
  assert.equal(cancelled, true);
  online = true;
  assert.equal((await value.flush()).replayed, 1);
  assert.equal(new Set(bodies).size, 1);
});

test("real loopback HTTP recovers a lost ACK with the same source-bound request", async (t) => {
  const requests = [],
    committed = new Map();
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    const raw = Buffer.concat(parts).toString("utf8"),
      body = JSON.parse(raw);
    requests.push({
      raw,
      method: request.method,
      path: request.url,
      headers: request.headers,
    });
    const replayed = committed.has(body.records[0].eventId);
    for (const entry of body.records) committed.set(entry.eventId, entry);
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
  assert(
    value.recordAction(
      {
        eventId: eventId(1),
        userId: "user_1",
        action: "report_saved",
        successful: true,
      },
      granted,
    ),
  );
  const status = await value.flush();
  assert.equal(status.acknowledged, 1);
  assert.equal(status.replayed, 1);
  assert.equal(committed.size, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].raw, requests[1].raw);
  for (const entry of requests) {
    assert.equal(entry.method, "POST");
    assert.equal(entry.path, `/v1/websites/${siteId}/application-observations`);
    assert.equal(entry.headers.origin, origin);
    assert.equal(entry.headers["x-fonte-installation-id"], sourceId);
    assert.equal(entry.headers["x-fonte-installation-key"], serverKey);
    assert.equal(entry.headers.authorization, undefined);
    assert.equal(entry.headers.cookie, undefined);
    assert.equal(entry.headers["content-type"], "application/json");
  }
});

test("configuration and browser failures expose constant codes without secret interpolation", () => {
  const base = { siteId, sourceId, serverKey, origin, policyVersion: "app-v1" };
  for (const invalid of [
    { sourceId: undefined },
    { siteId: "other" },
    { apiOrigin: "http://evil.example.test" },
    { apiOrigin: `https://user:${serverKey}@api.example.test` },
    { apiOrigin: "https://api.example.test/private" },
    { origin: "https://app.example.test/" },
    { serverKey: `${serverKey}\nprivate` },
    { queueLimit: 1_001 },
    { batchSize: 101 },
    { timeoutMs: 751 },
    { maxRetries: 4 },
    { now: "invalid" },
    { fetch: "invalid" },
  ])
    assert.throws(() => createFonteApplicationSource({ ...base, ...invalid }), {
      message: "fonte_application_configuration_invalid",
    });
  const old = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  try {
    assert.throws(() => createFonteApplicationSource(base), {
      message: "fonte_application_server_only",
    });
  } finally {
    if (old) Object.defineProperty(globalThis, "window", old);
    else delete globalThis.window;
  }
});
