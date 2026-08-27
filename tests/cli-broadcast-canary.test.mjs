import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { runProgram } from "../packages/cli/dist/program.js";

const workspace = "synthetic-canary";
const broadcastId = "20000000-0000-4000-8000-000000000174";
const operationId = "20000000-0000-4000-8000-000000000175";
const bearer = "synthetic.canary.bearer";
const startedAt = Date.parse("2026-08-24T12:00:00.000Z");
const initial = {
  released: 35_200,
  held: 87_041,
  accepted: 34_993,
  pending: 100,
  unknown: 106,
  cancelled: 1,
};
const settled = { ...initial, accepted: 35_093, pending: 0 };
const overlapInitial = {
  released: 38_015,
  held: 6_009,
  accepted: 37_574,
  pending: 335,
  unknown: 106,
};
const additionalReleaseKeys = Array.from(
  { length: 120 },
  (_, index) =>
    `20000000-0000-4000-8000-${String(176 + index).padStart(12, "0")}`,
);

test("historical pending overlaps held release and cancellation headroom reaches the exact accepted target", async () => {
  const harness = canaryHarness([
    progress({ ...overlapInitial, status: "paused", controlState: "paused" }),
    progress(overlapInitial),
    json({ error: "core_api_unavailable" }, 503),
    progress({
      released: 43_689,
      held: 335,
      accepted: 37_574,
      pending: 6_009,
      unknown: 106,
    }),
    progress({
      released: 43_689,
      held: 335,
      accepted: 38_000,
      pending: 5_582,
      unknown: 106,
      cancelled: 1,
    }),
    progress({
      released: 43_690,
      held: 334,
      accepted: 38_000,
      pending: 5_583,
      unknown: 106,
      cancelled: 1,
    }),
    progress({
      released: 43_690,
      held: 334,
      accepted: 43_583,
      unknown: 106,
      cancelled: 1,
    }),
    progress({
      released: 43_690,
      held: 334,
      accepted: 43_583,
      unknown: 106,
      cancelled: 1,
      status: "paused",
      controlState: "paused",
    }),
  ]);

  const result = await runProgram(
    argumentsForCanary(43_583, "release-to-43583"),
    harness.dependencies,
  );
  const receipt = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(harness.authorizationCalls(), 1);
  assert.deepEqual(
    harness.coreRequests().map(({ method, body }) => ({ method, body })),
    [
      { method: "GET", body: null },
      {
        method: "POST",
        body: {
          operation: "resume",
          expectedControlVersion: "75695",
        },
      },
      {
        method: "POST",
        body: {
          operation: "release",
          idempotencyKey: "release-to-43583",
          maximumRecipientCount: 5_674,
        },
      },
      {
        method: "POST",
        body: {
          operation: "release",
          idempotencyKey: "release-to-43583",
          maximumRecipientCount: 5_674,
        },
      },
      { method: "GET", body: null },
      {
        method: "POST",
        body: {
          operation: "release",
          idempotencyKey: additionalReleaseKeys[0],
          maximumRecipientCount: 1,
        },
      },
      { method: "GET", body: null },
      {
        method: "POST",
        body: {
          operation: "pause",
          expectedControlVersion: "87380",
        },
      },
    ],
  );
  assert.deepEqual(
    new Set(harness.coreRequests().map(({ bearer: value }) => value)),
    new Set([bearer]),
  );
  assert.equal(
    receipt.reason,
    "broadcast_canary_ceiling_settled_with_cancellation_and_paused",
  );
  assert.equal(receipt.result.release_ceiling, 43_583);
  assert.equal(receipt.result.baseline.released_recipient_count, 38_015);
  assert.equal(receipt.result.baseline.pending_recipient_count, 335);
  assert.equal(receipt.result.baseline.accepted_recipient_count, 37_574);
  assert.equal(receipt.result.baseline.unknown_recipient_count, 106);
  assert.equal(receipt.result.final.released_recipient_count, 43_690);
  assert.equal(receipt.result.final.held_recipient_count, 334);
  assert.equal(receipt.result.final.accepted_recipient_count, 43_583);
  assert.equal(receipt.result.final.pending_recipient_count, 0);
  assert.equal(receipt.result.final.claimed_recipient_count, 0);
  assert.equal(receipt.result.final.unknown_recipient_count, 106);
  assert.equal(receipt.result.final.cancelled_recipient_count, 1);
  assert.equal(receipt.result.final.control_state, "paused");
  assert.deepEqual(receipt.result.completed_steps, [
    "authoritative_status",
    "safe_resume",
    "guarded_release",
    "authoritative_wait_read",
    "safety_pause",
  ]);
  assert.equal(receipt.result.authorization.status, "released");
  assert.equal(receipt.result.authorization.bearer_persisted, false);
  assert.equal(result.stdout.includes(bearer), false);
});

test("new cancellations cannot conceal a release overshoot or accepted-count regression", async () => {
  const negativeBaseline = {
    released: 107,
    held: 20,
    accepted: 100,
    pending: 5,
    unknown: 2,
  };
  for (const [name, unsafe, reason] of [
    [
      "overshoot",
      progress({
        released: 123,
        held: 4,
        accepted: 100,
        pending: 21,
        unknown: 2,
      }),
      "broadcast_canary_release_ceiling_not_exact",
    ],
    [
      "regression",
      progress({
        released: 122,
        held: 5,
        accepted: 99,
        pending: 21,
        unknown: 2,
      }),
      "broadcast_canary_authority_changed",
    ],
  ]) {
    const harness = canaryHarness([
      progress({
        ...negativeBaseline,
        status: "paused",
        controlState: "paused",
      }),
      progress(negativeBaseline),
      unsafe,
      { ...unsafe, status: "paused", controlState: "paused" },
    ]);

    const result = await runProgram(
      argumentsForCanary(120, "release-to-120"),
      harness.dependencies,
    );
    const receipt = JSON.parse(result.stdout);

    assert.equal(result.exitCode, 3, name);
    assert.equal(receipt.reason, reason, name);
    assert.equal(receipt.result.final.control_state, "paused", name);
    assert.equal(
      harness.coreRequests().filter(({ body }) => body?.operation === "release")
        .length,
      1,
      name,
    );
  }
});

test("an auth-invalid opaque bearer is renewed after partial releases before the exact ceiling continues", async () => {
  const expiredBearer = "opaque-access-expired";
  const renewedBearer = "opaque-access-renewed";
  const renewalInitial = {
    released: 105,
    held: 20,
    accepted: 100,
    unknown: 5,
  };
  const responses = [
    progress({
      ...renewalInitial,
      status: "paused",
      controlState: "paused",
    }),
    progress(renewalInitial),
    progress({
      released: 115,
      held: 10,
      accepted: 100,
      pending: 10,
      unknown: 5,
    }),
    json({ error: "human_auth_invalid" }, 401),
    progress({ released: 115, held: 10, accepted: 110, unknown: 5 }),
    progress({
      released: 115,
      held: 10,
      accepted: 110,
      unknown: 5,
      status: "paused",
      controlState: "paused",
    }),
  ];
  const harness = canaryHarness(responses, {
    bearers: [expiredBearer, renewedBearer],
    sleepAdvanceMilliseconds: 0,
  });

  const result = await runProgram(
    argumentsForCanary(110, "release-to-110"),
    harness.dependencies,
  );
  const receipt = JSON.parse(result.stdout);
  const requests = harness.coreRequests();
  const renewalIndex = requests.findIndex(
    ({ bearer: value }) => value === renewedBearer,
  );
  const releases = requests.filter(({ body }) => body?.operation === "release");

  assert.equal(result.exitCode, 0);
  assert.equal(harness.authorizationCalls(), 2);
  assert.equal(harness.browserAuthorizationCalls(), 1);
  assert.equal(harness.renewalCalls(), 1);
  assert.equal(harness.freshnessChecks() > 1, true);
  assert.equal(renewalIndex > 0, true);
  assert.equal(requests[renewalIndex - 1].method, "GET");
  assert.equal(requests[renewalIndex].method, "GET");
  assert.equal(releases.length, 1);
  assert.equal(releases[0].body.maximumRecipientCount, 10);
  assert.equal(receipt.outcome, "completed");
  assert.equal(receipt.core_effect, "controlled");
  assert.equal(receipt.result.final.released_recipient_count, 115);
  assert.equal(receipt.result.final.accepted_recipient_count, 110);
  assert.equal(receipt.result.final.pending_recipient_count, 0);
  assert.equal(receipt.result.final.control_state, "paused");
  assert.equal(result.stdout.includes(expiredBearer), false);
  assert.equal(result.stdout.includes(renewedBearer), false);
});

test("refresh failure after an observed release is fail-closed without replaying the mutation", async () => {
  const activeRelease = progress({
    released: 36_207,
    held: 86_034,
    accepted: 35_093,
    pending: 1_007,
    unknown: 106,
    cancelled: 1,
  });
  const harness = canaryHarness(
    [
      progress({ ...settled, status: "paused", controlState: "paused" }),
      progress(settled),
      activeRelease,
      json({ error: "human_auth_invalid" }, 401),
    ],
    {
      renewError: new HostedTestBlockedError("authorization_refresh_failed"),
    },
  );

  const result = await runProgram(argumentsForCanary(), harness.dependencies);
  const receipt = JSON.parse(result.stdout);
  const releases = harness
    .coreRequests()
    .filter(({ body }) => body?.operation === "release");

  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "authorization_refresh_failed");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(receipt.result.final.control_state, "active");
  assert.equal(receipt.result.final.pending_recipient_count, 1_007);
  assert.equal(harness.browserAuthorizationCalls(), 1);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].body.idempotencyKey, "release-to-36100");
});

test("cancellation after an observed release renews authorization and returns a truthful paused effect", async () => {
  const cancellation = new AbortController();
  const activeRelease = progress({
    released: 36_207,
    held: 86_034,
    accepted: 35_093,
    pending: 1_007,
    unknown: 106,
    cancelled: 1,
  });
  let cancelled = false;
  const harness = canaryHarness(
    [
      progress({ ...settled, status: "paused", controlState: "paused" }),
      progress(settled),
      activeRelease,
      activeRelease,
      progress({
        released: 36_207,
        held: 86_034,
        accepted: 35_093,
        pending: 1_007,
        unknown: 106,
        cancelled: 1,
        status: "paused",
        controlState: "paused",
      }),
    ],
    {
      bearers: ["synthetic.canary.initial", "synthetic.canary.safety"],
      signal: cancellation.signal,
      afterCoreRequest: ({ body }) => {
        if (!cancelled && body?.operation === "release") {
          cancelled = true;
          cancellation.abort();
        }
      },
    },
  );

  const result = await runProgram(argumentsForCanary(), harness.dependencies);
  const receipt = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 3);
  assert.equal(harness.authorizationCalls(), 2);
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "operation_cancelled");
  assert.equal(receipt.core_effect, "controlled");
  assert.equal(receipt.result.final.released_recipient_count, 36_207);
  assert.equal(receipt.result.final.pending_recipient_count, 1_007);
  assert.equal(receipt.result.final.control_state, "paused");
  assert.deepEqual(
    harness.coreRequests().map(({ method, bearer: value }) => [method, value]),
    [
      ["GET", "synthetic.canary.initial"],
      ["POST", "synthetic.canary.initial"],
      ["POST", "synthetic.canary.initial"],
      ["GET", "synthetic.canary.safety"],
      ["POST", "synthetic.canary.safety"],
    ],
  );
});

test("unknown, refused, or authority drift still pauses immediately", async () => {
  for (const [name, change, reason] of [
    ["unknown", { unknown: 107 }, "broadcast_canary_unknown_increase"],
    ["refused", { refused: 1 }, "broadcast_canary_refused_increase"],
    [
      "authority",
      { pending: 1_107, status: "paused", controlState: "paused" },
      "broadcast_canary_authority_changed",
    ],
  ]) {
    const unsafe = {
      released: 36_207,
      held: 86_034,
      accepted: 34_993,
      pending: 1_106,
      unknown: 106,
      cancelled: 1,
      ...change,
    };
    const harness = canaryHarness([
      progress({ ...initial, status: "paused", controlState: "paused" }),
      progress(initial),
      progress({
        released: 36_207,
        held: 86_034,
        accepted: 34_993,
        pending: 1_107,
        unknown: 106,
        cancelled: 1,
      }),
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
      ["GET", "POST", "POST", "GET", "POST"],
      name,
    );
  }
});

test("a release with no positive progress pauses without retrying the mutation", async () => {
  const harness = canaryHarness([
    progress({ ...initial, status: "paused", controlState: "paused" }),
    progress(initial),
    progress(initial),
    progress({ ...initial, status: "paused", controlState: "paused" }),
  ]);

  const result = await runProgram(argumentsForCanary(), harness.dependencies);
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "broadcast_canary_release_no_progress");
  assert.equal(receipt.result.final.control_state, "paused");
  assert.deepEqual(
    harness.coreRequests().map(({ method }) => method),
    ["GET", "POST", "POST", "POST"],
  );
});

function argumentsForCanary(
  releaseCeiling = 36_100,
  idempotencyKey = "release-to-36100",
) {
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
    String(releaseCeiling),
    "--idempotency-key",
    idempotencyKey,
    "--json",
  ];
  assert.equal(parseArguments(argv).operator.kind, "broadcast_canary");
  return argv;
}

function canaryHarness(responses, options = {}) {
  let nowMilliseconds = startedAt;
  let browserAuthorizationCount = 0;
  let freshnessCheckCount = 0;
  let renewalCount = 0;
  let responseIndex = 0;
  let uuidIndex = 0;
  const requests = [];
  const uuids = [operationId, ...additionalReleaseKeys];
  return {
    dependencies: {
      cwd: process.cwd(),
      randomUUID: () => uuids[uuidIndex++],
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
          const request = {
            method: init.method,
            body,
            bearer: init.headers.authorization.replace("Bearer ", ""),
          };
          requests.push(request);
          const response = responses[responseIndex++];
          options.afterCoreRequest?.(request);
          if (response instanceof Error) throw response;
          if (response instanceof Response) return response;
          return json(response);
        },
        authorize: async () => {
          browserAuthorizationCount += 1;
          return options.bearers?.[0] ?? bearer;
        },
        renewAuthorization: async (_config, _signal, force = false) => {
          if (!force) {
            freshnessCheckCount += 1;
            return options.bearers?.[renewalCount] ?? bearer;
          }
          renewalCount += 1;
          if (options.renewError) throw options.renewError;
          return options.bearers?.[renewalCount] ?? bearer;
        },
        sleep: async (milliseconds) => {
          nowMilliseconds += options.sleepAdvanceMilliseconds ?? milliseconds;
        },
        signal: options.signal,
        now: () => new Date(nowMilliseconds),
      },
    },
    authorizationCalls: () => browserAuthorizationCount + renewalCount,
    browserAuthorizationCalls: () => browserAuthorizationCount,
    freshnessChecks: () => freshnessCheckCount,
    renewalCalls: () => renewalCount,
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
    controlVersion: String(released + accepted + refused + unknown + cancelled),
    progressVersion: String(
      released + accepted + refused + unknown + cancelled,
    ),
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
