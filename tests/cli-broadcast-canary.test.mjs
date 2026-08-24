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
  released: 35_200,
  held: 87_041,
  accepted: 34_993,
  pending: 100,
  unknown: 106,
  cancelled: 1,
};
const settled = { ...initial, accepted: 35_093, pending: 0 };
const cancellationWindowBaseline = {
  released: 66_100,
  held: 56_141,
  accepted: 65_991,
  unknown: 106,
  cancelled: 3,
};
const additionalReleaseKeys = Array.from(
  { length: 120 },
  (_, index) =>
    `20000000-0000-4000-8000-${String(176 + index).padStart(12, "0")}`,
);

test("one bearer settles queued work and reaches the exact ceiling through bounded partial tranches", async () => {
  const trancheResponses = Array.from({ length: 9 }, (_, index) => {
    const released = 35_300 + index * 100;
    const held = 86_941 - index * 100;
    const accepted = 35_093 + index * 100;
    return [
      progress({
        released,
        held,
        accepted,
        pending: 100,
        unknown: 106,
        cancelled: 1,
      }),
      progress({
        released,
        held,
        accepted: accepted + 100,
        unknown: 106,
        cancelled: 1,
      }),
    ];
  }).flat();
  const harness = canaryHarness([
    progress({ ...initial, status: "paused", controlState: "paused" }),
    progress(initial),
    progress(settled),
    ...trancheResponses,
    progress({
      released: 36_100,
      held: 86_141,
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
  const trancheRequests = Array.from({ length: 9 }, (_, index) => [
    {
      method: "POST",
      body: {
        operation: "release",
        idempotencyKey:
          index === 0 ? "release-to-36100" : additionalReleaseKeys[index - 1],
        maximumRecipientCount: 900 - index * 100,
      },
    },
    { method: "GET", body: null },
  ]).flat();
  assert.deepEqual(
    harness.coreRequests().map(({ method, body }) => ({ method, body })),
    [
      { method: "GET", body: null },
      { method: "POST", body: { operation: "resume" } },
      { method: "GET", body: null },
      ...trancheRequests,
      { method: "POST", body: { operation: "pause" } },
    ],
  );
  assert.deepEqual(
    new Set(harness.coreRequests().map(({ bearer: value }) => value)),
    new Set([bearer]),
  );
  assert.equal(receipt.reason, "broadcast_canary_ceiling_accepted_and_paused");
  assert.equal(receipt.result.release_ceiling, 36_100);
  assert.equal(receipt.result.baseline.released_recipient_count, 35_200);
  assert.equal(receipt.result.baseline.accepted_recipient_count, 35_093);
  assert.equal(receipt.result.baseline.unknown_recipient_count, 106);
  assert.equal(receipt.result.baseline.cancelled_recipient_count, 1);
  assert.equal(receipt.result.final.released_recipient_count, 36_100);
  assert.equal(receipt.result.final.held_recipient_count, 86_141);
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

test("a conserved 10000-recipient window completes with 9999 accepted and one newly cancelled", async () => {
  const responses = [
    progress({
      ...cancellationWindowBaseline,
      status: "paused",
      controlState: "paused",
    }),
    progress(cancellationWindowBaseline),
  ];
  for (let index = 0; index < 100; index += 1) {
    const released = 66_200 + index * 100;
    const held = 56_041 - index * 100;
    const accepted = 65_991 + index * 100;
    responses.push(
      progress({
        released,
        held,
        accepted,
        pending: 100,
        unknown: 106,
        cancelled: 3,
      }),
      progress({
        released,
        held,
        accepted: accepted + (index === 99 ? 99 : 100),
        unknown: 106,
        cancelled: index === 99 ? 4 : 3,
      }),
    );
  }
  responses.push(
    progress({
      released: 76_100,
      held: 46_141,
      accepted: 75_990,
      unknown: 106,
      cancelled: 4,
      status: "paused",
      controlState: "paused",
    }),
  );
  const harness = canaryHarness(responses, {
    sleepAdvanceMilliseconds: 0,
  });

  const result = await runProgram(
    argumentsForCanary(76_100, "release-to-76100"),
    harness.dependencies,
  );
  const receipt = JSON.parse(result.stdout);
  const releases = harness.coreRequests().filter(
    ({ body }) => body?.operation === "release",
  );

  assert.equal(result.exitCode, 0);
  assert.equal(harness.authorizationCalls(), 1);
  assert.equal(releases.length, 100);
  assert.equal(
    new Set(releases.map(({ body }) => body.idempotencyKey)).size,
    100,
  );
  assert.deepEqual(
    releases.map(({ body }) => body.maximumRecipientCount),
    Array.from({ length: 100 }, (_, index) => 10_000 - index * 100),
  );
  assert.equal(
    receipt.reason,
    "broadcast_canary_ceiling_settled_with_cancellation_and_paused",
  );
  assert.equal(
    receipt.result.final.accepted_recipient_count -
      receipt.result.baseline.accepted_recipient_count,
    9_999,
  );
  assert.equal(
    receipt.result.final.cancelled_recipient_count -
      receipt.result.baseline.cancelled_recipient_count,
    1,
  );
  assert.equal(receipt.result.final.released_recipient_count, 76_100);
  assert.equal(receipt.result.final.held_recipient_count, 46_141);
  assert.equal(receipt.result.final.unknown_recipient_count, 106);
  assert.equal(receipt.result.final.refused_recipient_count, 0);
  assert.equal(receipt.result.final.control_state, "paused");
});

test("new cancellations cannot conceal a release overshoot or accepted-count regression", async () => {
  for (const [name, unsafe, reason] of [
    [
      "overshoot",
      progress({
        released: 76_101,
        held: 46_140,
        accepted: 75_990,
        pending: 1,
        unknown: 106,
        cancelled: 4,
      }),
      "broadcast_canary_release_ceiling_not_exact",
    ],
    [
      "regression",
      progress({
        released: 76_100,
        held: 46_141,
        accepted: 65_990,
        unknown: 106,
        cancelled: 10_004,
      }),
      "broadcast_canary_authority_changed",
    ],
  ]) {
    const harness = canaryHarness([
      progress({
        ...cancellationWindowBaseline,
        status: "paused",
        controlState: "paused",
      }),
      progress(cancellationWindowBaseline),
      unsafe,
      { ...unsafe, status: "paused", controlState: "paused" },
    ]);

    const result = await runProgram(
      argumentsForCanary(76_100, "release-to-76100"),
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

test("an expired bearer is renewed after partial releases before the exact ceiling continues", async () => {
  const expiredBearer = "synthetic.canary.expired";
  const renewedBearer = "synthetic.canary.renewed";
  const renewalInitial = {
    released: 36_100,
    held: 86_141,
    accepted: 35_993,
    unknown: 106,
    cancelled: 1,
  };
  const responses = [
    progress({
      ...renewalInitial,
      status: "paused",
      controlState: "paused",
    }),
    progress(renewalInitial),
  ];
  for (let index = 0; index < 50; index += 1) {
    const released = 36_200 + index * 100;
    const held = 86_041 - index * 100;
    const accepted = 35_993 + index * 100;
    responses.push(
      progress({
        released,
        held,
        accepted,
        pending: 100,
        unknown: 106,
        cancelled: 1,
      }),
    );
    if (released === 37_000) {
      responses.push(json({ error: "human_auth_invalid" }, 401));
    }
    responses.push(
      progress({
        released,
        held,
        accepted: accepted + 100,
        unknown: 106,
        cancelled: 1,
      }),
    );
  }
  responses.push(
    progress({
      released: 41_100,
      held: 81_141,
      accepted: 40_993,
      unknown: 106,
      cancelled: 1,
      status: "paused",
      controlState: "paused",
    }),
  );
  const harness = canaryHarness(responses, {
    bearers: [expiredBearer, renewedBearer],
    sleepAdvanceMilliseconds: 0,
  });

  const result = await runProgram(
    argumentsForCanary(41_100),
    harness.dependencies,
  );
  const receipt = JSON.parse(result.stdout);
  const requests = harness.coreRequests();
  const renewalIndex = requests.findIndex(
    ({ bearer: value }) => value === renewedBearer,
  );
  const releases = requests.filter(
    ({ body }) => body?.operation === "release",
  );

  assert.equal(result.exitCode, 0);
  assert.equal(harness.authorizationCalls(), 2);
  assert.equal(renewalIndex > 0, true);
  assert.equal(requests[renewalIndex - 1].method, "GET");
  assert.equal(requests[renewalIndex].method, "GET");
  assert.equal(releases.length, 50);
  assert.equal(
    new Set(releases.map(({ body }) => body.idempotencyKey)).size,
    50,
  );
  assert.deepEqual(
    releases.map(({ body }) => body.maximumRecipientCount),
    Array.from({ length: 50 }, (_, index) => 5_000 - index * 100),
  );
  assert.equal(receipt.outcome, "completed");
  assert.equal(receipt.core_effect, "controlled");
  assert.equal(receipt.result.final.released_recipient_count, 41_100);
  assert.equal(receipt.result.final.accepted_recipient_count, 40_993);
  assert.equal(receipt.result.final.pending_recipient_count, 0);
  assert.equal(receipt.result.final.control_state, "paused");
  assert.equal(result.stdout.includes(expiredBearer), false);
  assert.equal(result.stdout.includes(renewedBearer), false);
});

test("cancellation after an observed release renews authorization and returns a truthful paused effect", async () => {
  const cancellation = new AbortController();
  const activeRelease = progress({
    released: 35_300,
    held: 86_941,
    accepted: 35_093,
    pending: 100,
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
        released: 35_300,
        held: 86_941,
        accepted: 35_093,
        pending: 100,
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
  assert.equal(receipt.result.final.released_recipient_count, 35_300);
  assert.equal(receipt.result.final.pending_recipient_count, 100);
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
      { pending: 100, status: "paused", controlState: "paused" },
      "broadcast_canary_authority_changed",
    ],
  ]) {
    const unsafe = {
      released: 35_300,
      held: 86_941,
      accepted: 35_093,
      pending: 99,
      unknown: 106,
      cancelled: 1,
      ...change,
    };
    const harness = canaryHarness([
      progress({ ...initial, status: "paused", controlState: "paused" }),
      progress(initial),
      progress(settled),
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

test("a release with no positive progress pauses without retrying the mutation", async () => {
  const harness = canaryHarness([
    progress({ ...initial, status: "paused", controlState: "paused" }),
    progress(initial),
    progress(settled),
    progress(settled),
    progress({ ...settled, status: "paused", controlState: "paused" }),
  ]);

  const result = await runProgram(argumentsForCanary(), harness.dependencies);
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "broadcast_canary_release_no_progress");
  assert.equal(receipt.result.final.control_state, "paused");
  assert.deepEqual(
    harness.coreRequests().map(({ method }) => method),
    ["GET", "POST", "GET", "POST", "POST"],
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
  let authorizationCount = 0;
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
          authorizationCount += 1;
          return options.bearers?.[authorizationCount - 1] ?? bearer;
        },
        sleep: async (milliseconds) => {
          nowMilliseconds += options.sleepAdvanceMilliseconds ?? milliseconds;
        },
        signal: options.signal,
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
