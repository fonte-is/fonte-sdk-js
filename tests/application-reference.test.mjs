import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFonteApplicationSource } from "@fonte-is/nextjs/application";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiled = mkdtempSync(join(tmpdir(), "fonte-application-reference-"));
after(() => rmSync(compiled, { recursive: true, force: true }));
writeFileSync(join(compiled, "package.json"), '{"type":"module"}\n');
execFileSync(
  process.execPath,
  [
    join(root, "node_modules/typescript/bin/tsc"),
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--noUnusedLocals",
    "--noUnusedParameters",
    "--skipLibCheck",
    "--rootDir",
    "examples/application-nextjs",
    "--outDir",
    compiled,
    "examples/application-nextjs/ports.ts",
    "examples/application-nextjs/journey.ts",
  ],
  { cwd: root, stdio: "pipe" },
);
const { createApplicationJourney } = await import(
  pathToFileURL(join(compiled, "journey.js")).href
);

// Explicit synthetic host fixtures: no customer session or provider is connected.
const at = "2026-10-05T12:00:00.000Z";
const siteId = "site_0123456789abcdef0123456789abcdef";
const sourceId = "application_nextjs_reference";
const origin = "https://app.example.test";
const serverKey = "synthetic-reference-server-key-123456789";
const granted = { activity: "granted", identityLink: "granted" };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = (extra = {}) => ({
  userId: "user_1",
  accountId: "account_1",
  contactId: "contact_1",
  sourcePartyId: id(90),
  membership: {
    observationId: id(1),
    validFrom: "2026-10-01T00:00:00.000Z",
    validUntil: null,
  },
  measurementPermissions: granted,
  ...extra,
});
const report = {
  title: "Private report title",
  body: "Private report content must stay in the existing business store.",
};
const saved = () => ({
  result: { reportId: "report_1", title: report.title },
  observation: { observationId: id(2), committedAt: at },
});
const plan = (extra = {}) => ({
  result: { plan: "pro", state: "effective" },
  observation: {
    observationId: id(3),
    committedAt: at,
    previousPlan: "free",
    effectivePlan: "pro",
    state: "effective",
    priorStateVerified: true,
    ...extra,
  },
});
function ports(extra = {}) {
  return {
    requireVerifiedSession: async () => session(),
    saveReport: async () => saved(),
    commitPlan: async () => plan(),
    ...extra,
  };
}

async function sink(t) {
  const requests = [],
    stored = new Map();
  let responseStatus = 200;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ path: request.url, headers: request.headers, body });
      if (responseStatus !== 200) {
        response.writeHead(responseStatus).end();
        return;
      }
      const records = [];
      for (const record of body.records) {
        const existing = stored.get(record.eventId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
          response.writeHead(409).end();
          return;
        }
        records.push({
          eventId: record.eventId,
          outcome: existing ? "replayed" : "stored",
        });
        stored.set(record.eventId, record);
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          schema: "fonte.application.receipt.v1",
          sourceId: body.sourceId,
          acceptedAt: at,
          records,
          delivery: "best_effort",
        }),
      );
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  });
  return {
    apiOrigin: `http://127.0.0.1:${server.address().port}`,
    requests,
    stored,
    fail(status) {
      responseStatus = status;
    },
  };
}
function client(t, receiver, extra = {}) {
  const source = createFonteApplicationSource({
    apiOrigin: receiver.apiOrigin,
    siteId,
    sourceId,
    serverKey,
    origin,
    policyVersion: "app-v1",
    now: () => Date.parse(at),
    allowInsecureLocalhost: true,
    flushDelayMs: 1_000,
    timeoutMs: 100,
    maxRetries: 0,
    ...extra,
  });
  t.after(() => source.close());
  return source;
}
const journey = (existing, source) =>
  createApplicationJourney(
    existing,
    () => source,
    () => Date.parse(at),
  );
const records = (receiver, kind) =>
  receiver.requests
    .flatMap(({ body }) => body.records)
    .filter((record) => kind === undefined || record.kind === kind);

test("authenticated report success uses committed facts and returns before delivery", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const sequence = [],
    committed = saved();
  const app = journey(
    ports({
      requireVerifiedSession: async () => {
        sequence.push("authenticated");
        return session();
      },
      saveReport: async (input) => {
        sequence.push("committed");
        assert.deepEqual(input, {
          userId: "user_1",
          accountId: "account_1",
          report,
        });
        assert.equal(source.status().enqueued, 0);
        return committed;
      },
    }),
    source,
  );
  assert.equal(await app.saveReport(report), committed.result);
  assert.deepEqual(sequence, ["authenticated", "committed"]);
  assert.equal(receiver.requests.length, 0);
  assert.equal(source.status().queued, 3);
  assert.equal((await source.flush()).acknowledged, 3);
  assert.deepEqual(
    records(receiver).map(({ kind }) => kind),
    ["relationship", "access", "action"],
  );
  assert.deepEqual(records(receiver, "action"), [
    {
      kind: "action",
      eventId: id(2),
      occurredAt: at,
      userId: "user_1",
      accountId: "account_1",
      actor: "user",
      action: "report_saved",
      successful: true,
    },
  ]);
  assert.equal(records(receiver, "relationship")[0].occurredAt, undefined);
  assert.equal(records(receiver, "relationship")[0].contactId, "contact_1");
  assert.equal(records(receiver, "relationship")[0].sourcePartyId, id(90));
  const [{ headers, path, body }] = receiver.requests;
  assert.equal(path, `/v1/websites/${siteId}/application-observations`);
  assert.equal(headers.origin, origin);
  assert.equal(headers["x-fonte-installation-id"], sourceId);
  assert.equal(headers["x-fonte-installation-key"], serverKey);
  const wire = JSON.stringify(body);
  assert(!wire.includes(report.title));
  assert(!wire.includes(report.body));
  assert(!wire.includes(serverKey));
});

test("verified account returns provide authenticated access without an action claim", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  assert.deepEqual(await journey(ports(), source).openAccount(), {
    userId: "user_1",
    accountId: "account_1",
  });
  await source.flush();
  assert.deepEqual(
    records(receiver).map(({ kind }) => kind),
    ["relationship", "access"],
  );
});

test("all denied/unknown permission combinations leave observation payloads unread", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  let reads = 0,
    sourceReads = 0,
    commits = 0;
  function forbidden() {
    reads++;
    throw Error("observation_payload_was_read");
  }
  for (const activity of ["granted", "denied", "unknown"])
    for (const identityLink of ["granted", "denied", "unknown"]) {
      if (activity === "granted" && identityLink === "granted") continue;
      const privateSession = {
        userId: "user_1",
        accountId: "account_1",
        measurementPermissions: { activity, identityLink },
      };
      for (const key of ["contactId", "sourcePartyId", "membership"])
        Object.defineProperty(privateSession, key, { get: forbidden });
      const privateReport = { result: saved().result },
        privatePlan = { result: plan().result };
      Object.defineProperty(privateReport, "observation", { get: forbidden });
      Object.defineProperty(privatePlan, "observation", { get: forbidden });
      const app = createApplicationJourney(
        ports({
          requireVerifiedSession: async () => privateSession,
          saveReport: async () => {
            commits++;
            return privateReport;
          },
          commitPlan: async () => {
            commits++;
            return privatePlan;
          },
        }),
        () => {
          sourceReads++;
          return source;
        },
      );
      assert.equal(await app.saveReport(report), privateReport.result);
      assert.equal(await app.upgradeToPro(), privatePlan.result);
      await app.openAccount();
    }
  await source.flush();
  assert.equal(commits, 16);
  assert.equal(reads, 0);
  assert.equal(sourceReads, 0);
  assert.equal(source.status().enqueued, 0);
  assert.equal(receiver.requests.length, 0);
});

test("unverified authentication cannot reach stores or collect identity", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const rejection = Error("existing_session_rejected");
  let calls = 0;
  const app = journey(
    ports({
      requireVerifiedSession: async () => {
        throw rejection;
      },
      saveReport: async () => {
        calls++;
        return saved();
      },
      commitPlan: async () => {
        calls++;
        return plan();
      },
    }),
    source,
  );
  for (const operation of [
    () => app.openAccount(),
    () => app.saveReport(report),
    () => app.upgradeToPro(),
  ])
    await assert.rejects(operation, (error) => error === rejection);
  await source.flush();
  assert.equal(calls, 0);
  assert.equal(source.status().enqueued, 0);
  assert.equal(receiver.requests.length, 0);
});

test("business failure propagates before any successful-action observation", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const failure = Error("existing_report_transaction_failed");
  const app = journey(
    ports({
      saveReport: async () => {
        throw failure;
      },
    }),
    source,
  );
  await assert.rejects(
    () => app.saveReport(report),
    (error) => error === failure,
  );
  await source.flush();
  assert.equal(source.status().enqueued, 0);
  assert.equal(receiver.requests.length, 0);
});

test("only verified effective free-to-pro entitlement facts emit an upgrade", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const committed = plan();
  const app = journey(
    ports({
      commitPlan: async (input) => {
        assert.deepEqual(input, {
          userId: "user_1",
          accountId: "account_1",
          requestedPlan: "pro",
        });
        assert.equal(source.status().enqueued, 0);
        return committed;
      },
    }),
    source,
  );
  assert.equal(await app.upgradeToPro(), committed.result);
  assert.equal(receiver.requests.length, 0);
  await source.flush();
  assert.deepEqual(records(receiver, "upgrade"), [
    {
      kind: "upgrade",
      eventId: id(3),
      occurredAt: at,
      accountId: "account_1",
      previousPlan: "free",
      effectivePlan: "pro",
      state: "effective",
      priorStateVerified: true,
    },
  ]);
  assert.equal(records(receiver, "upgrade")[0].previousRank, undefined);
  assert.equal(records(receiver, "upgrade")[0].effectiveRank, undefined);
});

test("failed and pending upgrades cannot be promoted to effective upgrades", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const failure = Error("existing_entitlement_transaction_failed");
  await assert.rejects(
    () =>
      journey(
        ports({
          commitPlan: async () => {
            throw failure;
          },
        }),
        source,
      ).upgradeToPro(),
    (error) => error === failure,
  );
  assert.equal(source.status().enqueued, 0);
  for (const facts of [
    { state: "pending" },
    { priorStateVerified: false },
    { previousPlan: null },
    { previousPlan: "pro" },
    { effectivePlan: "free" },
  ]) {
    const committed = plan(facts);
    if (facts.state === "pending") committed.result.state = "pending";
    assert.equal(
      await journey(
        ports({ commitPlan: async () => committed }),
        source,
      ).upgradeToPro(),
      committed.result,
    );
  }
  await source.flush();
  assert.equal(records(receiver, "upgrade").length, 0);
  assert.equal(records(receiver, "action").length, 0);
});

test("business replay reuses immutable observation UUIDs and receives replay ACKs", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const app = journey(ports(), source);
  await app.saveReport(report);
  await source.flush();
  await app.saveReport(report);
  const status = await source.flush();
  const actions = records(receiver, "action");
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0], actions[1]);
  assert.equal(receiver.stored.get(id(2)).eventId, id(2));
  assert.equal(status.replayed, 2); // Same committed action and membership; access is a new visit.
  assert.equal(status.stored, 4);
  assert.equal(status.acknowledged, 6);
});

test("HTTP outage preserves business success before the separate lifecycle drain", async (t) => {
  const receiver = await sink(t);
  receiver.fail(503);
  const source = client(t, receiver, { timeoutMs: 50 });
  const committed = saved(),
    app = journey(ports({ saveReport: async () => committed }), source);
  const started = performance.now();
  assert.equal(await app.saveReport(report), committed.result);
  assert(
    performance.now() - started < 50,
    "business work waited for observation delivery",
  );
  assert.equal(receiver.requests.length, 0);
  const status = await source.flush();
  assert.equal(status.state, "disconnected");
  assert.equal(status.acknowledged, 0);
  assert.equal(status.queued, 3);
  assert.equal(status.lastReason, "source_unavailable");
  receiver.fail(200);
  assert.equal((await source.flush()).acknowledged, 3);
});

test("source rejection and initialization faults cannot change committed user results", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  receiver.fail(403);
  const committed = saved(),
    existing = ports({ saveReport: async () => committed });
  const app = journey(existing, source);
  assert.equal(await app.saveReport(report), committed.result);
  assert.equal((await source.flush()).state, "blocked");
  assert.equal(await app.saveReport(report), committed.result);
  for (const getSource of [
    () => null,
    () => {
      throw Error(serverKey);
    },
  ]) {
    const isolated = createApplicationJourney(existing, getSource);
    assert.equal(await isolated.saveReport(report), committed.result);
  }
  const diagnostic = JSON.stringify(source.status());
  assert(!diagnostic.includes(serverKey));
  assert(!diagnostic.includes(report.title));
  assert(!diagnostic.includes("user_1"));
});

test("malformed observation metadata cannot turn a committed business operation into failure", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const committed = saved();
  Object.defineProperty(committed, "observation", {
    get() {
      throw Error("private-store-detail");
    },
  });
  assert.equal(
    await journey(
      ports({ saveReport: async () => committed }),
      source,
    ).saveReport(report),
    committed.result,
  );
  await source.flush();
  assert.equal(records(receiver, "action").length, 0);
});

test("application hooks contain no fabricated commerce or payment facts", async (t) => {
  const receiver = await sink(t),
    source = client(t, receiver);
  const app = journey(ports(), source);
  await app.saveReport(report);
  await app.upgradeToPro();
  await source.flush();
  assert(
    records(receiver).every(({ kind }) =>
      ["access", "relationship", "action", "upgrade"].includes(kind),
    ),
  );
  for (const record of records(receiver))
    for (const key of [
      "email",
      "paymentId",
      "amount",
      "currency",
      "collectedAt",
      "purchaseKind",
      "workspaceId",
      "environmentId",
    ])
      assert.equal(Object.hasOwn(record, key), false);
});
