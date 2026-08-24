import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const workspace = "synthetic-canary";
const broadcastId = "20000000-0000-4000-8000-000000000174";
const operationId = "20000000-0000-4000-8000-000000000175";
const bearer = "synthetic.canary.bearer";
const startedAt = Date.parse("2026-08-24T12:00:00.000Z");
const initial = {
  released: 35_100,
  held: 2_000,
  accepted: 34_992,
  pending: 1,
  unknown: 106,
  cancelled: 1,
};

test("one bearer settles a paused baseline, resumes once, adds 1,000 accepted recipients, and pauses", async () => {
  const harness = canaryHarness([
    progress({ ...initial, status: "paused", controlState: "paused" }),
    progress(initial),
    progress({ ...initial, accepted: 34_993, pending: 0 }),
    progress({
      released: 36_100,
      held: 1_000,
      accepted: 34_993,
      pending: 1_000,
      unknown: 106,
      cancelled: 1,
    }),
    progress({
      released: 36_100,
      held: 1_000,
      accepted: 35_993,
      unknown: 106,
      cancelled: 1,
    }),
    progress({
      released: 36_100,
      held: 1_000,
      accepted: 35_993,
      unknown: 106,
      cancelled: 1,
      status: "paused",
      controlState: "paused",
    }),
  ]);

  const result = await runProgram(argumentsForCanary(), harness.dependencies);
  const receipt = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(harness.authorizationCalls(), 1);
  assert.deepEqual(
    harness.coreRequests().map(({ method, body }) => ({ method, body })),
    [
      { method: "GET", body: null },
      { method: "POST", body: { operation: "resume" } },
      { method: "GET", body: null },
      {
        method: "POST",
        body: {
          operation: "release",
          idempotencyKey: "release-to-36100",
          maximumRecipientCount: 1_000,
        },
      },
      { method: "GET", body: null },
      { method: "POST", body: { operation: "pause" } },
    ],
  );
  assert.deepEqual(
    new Set(harness.coreRequests().map(({ bearer: value }) => value)),
    new Set([bearer]),
  );
  assert.equal(receipt.reason, "broadcast_canary_ceiling_accepted_and_paused");
  assert.equal(receipt.result.release_ceiling, 36_100);
  assert.equal(receipt.result.baseline.released_recipient_count, 35_100);
  assert.equal(receipt.result.baseline.accepted_recipient_count, 34_993);
  assert.equal(receipt.result.baseline.unknown_recipient_count, 106);
  assert.equal(receipt.result.baseline.cancelled_recipient_count, 1);
  assert.equal(receipt.result.final.released_recipient_count, 36_100);
  assert.equal(receipt.result.final.accepted_recipient_count, 35_993);
  assert.notEqual(
    receipt.result.final.accepted_recipient_count,
    receipt.result.release_ceiling,
  );
  assert.equal(receipt.result.final.unknown_recipient_count, 106);
  assert.equal(receipt.result.final.cancelled_recipient_count, 1);
  assert.equal(receipt.result.final.control_state, "paused");
  assert.deepEqual(receipt.result.completed_steps, [
    "authoritative_status",
    "safe_resume",
    "authoritative_wait_read",
    "guarded_release",
    "safety_pause",
  ]);
  assert.equal(receipt.result.authorization.status, "released");
  assert.equal(receipt.result.authorization.bearer_persisted, false);
  assert.equal(result.stdout.includes(bearer), false);
});

test("an increase above the frozen historical unknown or cancelled count pauses immediately", async () => {
  for (const [name, change, reason] of [
    ["unknown", { unknown: 107 }, "broadcast_canary_unknown_increase"],
    ["cancelled", { cancelled: 2 }, "broadcast_canary_cancelled_increase"],
  ]) {
    const unsafe = {
      released: 36_100,
      held: 1_000,
      accepted: 34_993,
      pending: 999,
      unknown: 106,
      cancelled: 1,
      ...change,
    };
    const harness = canaryHarness([
      progress({ ...initial, status: "paused", controlState: "paused" }),
      progress(initial),
      progress({ ...initial, accepted: 34_993, pending: 0 }),
      progress(unsafe),
      progress({ ...unsafe, status: "paused", controlState: "paused" }),
    ]);

    const result = await runProgram(argumentsForCanary(), harness.dependencies);
    const receipt = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 3, name);
    assert.equal(receipt.reason, reason, name);
    assert.equal(receipt.result.final.control_state, "paused", name);
    assert.equal(harness.authorizationCalls(), 1, name);
    assert.deepEqual(
      harness.coreRequests().map(({ method }) => method),
      ["GET", "POST", "GET", "POST", "POST"],
      name,
    );
  }
});

function argumentsForCanary() {
  const argv = [
    "broadcast",
    "canary",
    "--workspace",
    workspace,
    "--environment",
    "production",
    "--broadcast-id",
    broadcastId,
    "--release-ceiling",
    "36100",
    "--idempotency-key",
    "release-to-36100",
    "--json",
  ];
  assert.equal(parseArguments(argv).operator.kind, "broadcast_canary");
  return argv;
}

function canaryHarness(responses) {
  let nowMilliseconds = startedAt;
  let authorizationCount = 0;
  let responseIndex = 0;
  const requests = [];
  return {
    dependencies: {
      cwd: process.cwd(),
      randomUUID: () => operationId,
      runner: { run: async () => 1 },
      operator: {
        configUrl: "http://127.0.0.1:43111/.well-known/fonte-cli.json",
        fetch: async (input, init = {}) => {
          if (String(input).includes(".well-known/fonte-cli.json")) {
            return json({
              schema: "fonte.cli.hosted_config.v1",
              authorizationServer: "https://auth.example.test",
              clientId: "fonte-cli-client-v0",
              coreApiBaseUrl: "http://127.0.0.1:43112",
              redirectUri: "http://127.0.0.1:49671/callback",
              scopes: ["email"],
            });
          }
          const body = init.body ? JSON.parse(init.body) : null;
          requests.push({
            method: init.method,
            body,
            bearer: init.headers.authorization.replace("Bearer ", ""),
          });
          const response = responses[responseIndex++];
          if (response instanceof Error) throw response;
          return json(response);
        },
        authorize: async () => {
          authorizationCount += 1;
          return bearer;
        },
        sleep: async (milliseconds) => {
          nowMilliseconds += milliseconds;
        },
        now: () => new Date(nowMilliseconds),
      },
    },
    authorizationCalls: () => authorizationCount,
    coreRequests: () => requests,
  };
}

function progress({
  released,
  held,
  accepted,
  pending = 0,
  claimed = 0,
  refused = 0,
  unknown = 0,
  cancelled = 0,
  status = "processing",
  controlState = "active",
  asOf = "2026-08-24T12:00:00.000Z",
}) {
  return {
    tenantId: "workspace-synthetic-canary",
    environment: "production",
    marketingBroadcastId: broadcastId,
    status,
    controlState,
    progressVersion: String(released + accepted + refused + unknown + cancelled),
    requestedRecipientCount: released + held,
    eligibleRecipientCount: released + held,
    releasedRecipientCount: released,
    heldRecipientCount: held,
    excludedRecipientCount: 0,
    pendingRecipientCount: pending,
    claimedRecipientCount: claimed,
    acceptedRecipientCount: accepted,
    refusedRecipientCount: refused,
    unknownRecipientCount: unknown,
    cancelledRecipientCount: cancelled,
    remainingRecipientCount: held + pending + claimed,
    currentRatePerSecond: controlState === "active" ? 10 : null,
    asOf,
    estimatedCompletionAt:
      controlState === "active" ? "2026-08-24T12:01:00.000Z" : null,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
