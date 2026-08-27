import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { createBrowserAuthorizationSession } from "../packages/cli/dist/oauth.js";
import { createCoreRequester } from "../packages/cli/dist/operator-core-request.js";
import { renderOperatorHuman } from "../packages/cli/dist/operator-render.js";
import { runProgram } from "../packages/cli/dist/program.js";

const workspace = "synthetic-audience";
const tenantId = "workspace_synthetic_audience";
const broadcastId = "30000000-0000-4000-8000-000000000199";
const frozenAudienceId = "30000000-0000-4000-8000-000000000200";
const existingFrozenAudienceId = "30000000-0000-4000-8000-000000000201";
const recipientSnapshotId = "30000000-0000-4000-8000-000000000202";
const sendPlanDecisionId = "30000000-0000-4000-8000-000000000203";
const communicationPurposeId = "30000000-0000-4000-8000-000000000204";
const identitySetSha256 = "a".repeat(64);
const existingIdentitySetSha256 = "b".repeat(64);
const appendAuthorizationId = "synthetic-append-window-199";
const idempotencyKey = "synthetic-append-key-199";
const bearer = "opaque-audience-append-access";
const path =
  `/v1/workspaces/${workspace}/marketing-broadcasts/${broadcastId}` +
  "/audience-append?environment=production";
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const baseline = {
  authorizationId: "199",
  recipientSnapshotId,
  sendPlanDecisionId,
  draftVersion: 7,
  senderId: "synthetic-sender",
  renderContentDigest: `sha256:${"c".repeat(64)}`,
  communicationPurposeId,
  originalRecipientCount: 104,
  currentSnapshotCount: 100,
  currentReleasedRecipientCount: 100,
  currentAcceptedRecipientCount: 99,
  currentBillingReservedRecipientCount: 100,
  controlState: "active",
};

test("audience append grammar is exact and production-only", async () => {
  const parsed = parseArguments(argumentsForAppend("--json"));
  assert.equal(parsed.command, "operator");
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.operator, {
    kind: "broadcast_audience_append",
    workspace,
    broadcastId,
    frozenAudienceId,
    identitySetSha256,
    acceptedTargetCeiling: 120,
    appendAuthorizationId,
    idempotencyKey,
  });

  for (const invalid of [
    replaceArgument("--environment", "sandbox"),
    replaceArgument("--accepted-target-ceiling", "0"),
    replaceArgument("--accepted-target-ceiling", "-1"),
    replaceArgument("--broadcast-id", "not-a-uuid"),
    replaceArgument("--frozen-audience-id", "not-a-uuid"),
    replaceArgument("--identity-set-sha256", "A".repeat(64)),
    replaceArgument("--append-authorization-id", "x".repeat(201)),
    [...argumentsForAppend(), "--json", "--json"],
    [...argumentsForAppend(), "--contact-file", "recipients.csv"],
    [...argumentsForAppend(), "--recipient-email", "person@example.test"],
  ]) {
    assert.throws(() => parseArguments(invalid));
  }

  const source = await readFile(
    new URL("../packages/cli/src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const audienceAppendInvocation =/);
  assert.match(
    source,
    /broadcastCanaryInvocation \|\| audienceAppendInvocation/,
  );
});

test("audience append alone receives the bounded longer Core timeout", async () => {
  let prepared = 0;
  let opened = 0;
  const requests = [];
  const requestTimeouts = [];
  const timeoutBySignal = new Map();
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    const signal = new AbortController().signal;
    timeoutBySignal.set(signal, milliseconds);
    return signal;
  };
  const authorization = createBrowserAuthorizationSession({
    prepare: async () => {
      prepared += 1;
      return {
        state: "synthetic-state",
        authorizationUrl: new URL("https://identity.example.test/authorize"),
        exchange: async () => ({
          accessToken: bearer,
          refreshToken: "synthetic-memory-only-refresh",
          expiresInSeconds: 300,
        }),
      };
    },
    listenForOAuthCallback: async () => ({
      callback: Promise.resolve(
        new URL(
          "http://127.0.0.1:49671/callback?code=synthetic-code&state=synthetic-state",
        ),
      ),
      boundPort: 49671,
      transition: () => {},
      finish: () => {},
      close: () => {},
    }),
    openBrowser: async () => {
      opened += 1;
      return true;
    },
  });
  const dependencies = programDependencies(async (input, init = {}) => {
    if (String(input).includes(".well-known/fonte-cli.json"))
      return json(hosted);
    requestTimeouts.push(timeoutBySignal.get(init.signal));
    requests.push(coreRequest(input, init));
    return (init.method ?? "GET") === "GET"
      ? json(preflight())
      : json(appendReadback());
  }, authorization.authorize);

  let result;
  const unrelatedTimeouts = [];
  try {
    result = await runProgram(argumentsForAppend("--json"), dependencies);
    const unrelatedRequest = createCoreRequester({
      coreApiBaseUrl: hosted.coreApiBaseUrl,
      bearer,
      fetch: async (_input, init = {}) => {
        unrelatedTimeouts.push(timeoutBySignal.get(init.signal));
        return json({ ok: true });
      },
    });
    await unrelatedRequest("/v1/workspaces/unrelated/status");
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
  const receipt = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(prepared, 1);
  assert.equal(opened, 1);
  assert.deepEqual(requestTimeouts, [15_000, 60_000]);
  assert.deepEqual(unrelatedTimeouts, [15_000]);
  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: "GET", url: `https://api.example.test${path}` },
      { method: "POST", url: `https://api.example.test${path}` },
    ],
  );
  for (const request of requests) assert.equal(request.bearer, bearer);
  assert.deepEqual(requests[1], {
    method: "POST",
    url: `https://api.example.test${path}`,
    bearer,
    idempotencyKey,
    body: {
      expectedBaseline: baseline,
      frozenAudienceId,
      canonicalIdentitySetSha256: identitySetSha256,
      acceptedTargetCeiling: 120,
      appendAuthorizationId,
      idempotencyKey,
    },
  });
  assert.equal(receipt.reason, "broadcast_audience_append_completed");
  assert.equal(receipt.core_effect, "created");
  assert.equal(receipt.result.idempotency_key, idempotencyKey);
  assert.equal(receipt.result.aggregate.held_recipient_count, 20);
  assert.deepEqual(Object.keys(receipt.result).sort(), [
    "accepted_target_ceiling",
    "aggregate",
    "append_authorization_id",
    "baseline",
    "broadcast_id",
    "idempotency_key",
    "kind",
    "replayed",
    "segments",
  ]);
  assert.equal("source_provenance" in receipt.result.segments[1], false);
  const human = renderOperatorHuman(receipt);
  assert.match(human, /Accepted baseline\/ceiling\/current: 99\/120\/99/);
  assert.match(human, /Requested\/eligible\/released\/held: 129\/120\/100\/20/);
  assert.equal(human.includes("synthetic-provider-secret"), false);
  assert.equal(human.includes("hidden@example.test"), false);
  assert.equal(result.stdout.includes(bearer), false);
  assert.equal(result.stdout.includes("synthetic-memory-only-refresh"), false);
});

test("unknown or contact-shaped Core fields invalidate preflight and mutation receipts", async () => {
  let posts = 0;
  const invalidPreflight = await runProgram(
    argumentsForAppend("--json"),
    programDependencies(async (input, init = {}) => {
      if (String(input).includes(".well-known/fonte-cli.json"))
        return json(hosted);
      if ((init.method ?? "GET") === "POST") posts += 1;
      return json({ ...preflight(), contactRows: [{ email: "hidden" }] });
    }),
  );
  assert.equal(invalidPreflight.exitCode, 3);
  assert.equal(
    JSON.parse(invalidPreflight.stdout).reason,
    "core_operator_receipt_invalid",
  );
  assert.equal(posts, 0);

  const readback = appendReadback();
  const invalidReadback = await runProgram(
    argumentsForAppend("--json"),
    programDependencies(async (input, init = {}) => {
      if (String(input).includes(".well-known/fonte-cli.json"))
        return json(hosted);
      return (init.method ?? "GET") === "GET"
        ? json(preflight())
        : json({
            ...readback,
            providerPayload: { secret: "synthetic-provider-secret" },
          });
    }),
  );
  const receipt = JSON.parse(invalidReadback.stdout);
  assert.equal(invalidReadback.exitCode, 3);
  assert.equal(receipt.reason, "core_operator_receipt_invalid");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(
    invalidReadback.stdout.includes("synthetic-provider-secret"),
    false,
  );
});

test("baseline conflict and append failure states remain distinct and fail closed", async () => {
  const cases = [
    {
      status: 404,
      reason: "ignored",
      expected: "broadcast_audience_append_not_found",
      failOn: "GET",
    },
    {
      status: 409,
      reason: "baseline_drift",
      expected: "broadcast_audience_append_conflict",
      failOn: "POST",
    },
    {
      status: 422,
      reason: "ignored",
      expected: "broadcast_audience_append_has_no_new_recipients",
      failOn: "POST",
    },
    {
      status: 503,
      reason: "ignored",
      expected: "broadcast_audience_append_unavailable",
      failOn: "GET",
    },
    {
      status: 401,
      reason: "ignored",
      expected: "human_auth_invalid",
      failOn: "GET",
    },
  ];
  for (const scenario of cases) {
    let postCount = 0;
    const result = await runProgram(
      argumentsForAppend("--json"),
      programDependencies(async (input, init = {}) => {
        if (String(input).includes(".well-known/fonte-cli.json"))
          return json(hosted);
        const method = init.method ?? "GET";
        if (method === "POST") postCount += 1;
        if (method === scenario.failOn) {
          return json({ error: scenario.reason }, scenario.status);
        }
        return json(preflight());
      }),
    );
    const receipt = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 3, scenario.expected);
    assert.equal(receipt.reason, scenario.expected, scenario.expected);
    assert.equal(receipt.core_effect, "none", scenario.expected);
    assert.equal(postCount, scenario.failOn === "POST" ? 1 : 0);
  }
});

test("a lost POST response is unknown and is never retried automatically", async () => {
  let postCount = 0;
  const result = await runProgram(
    argumentsForAppend("--json"),
    programDependencies(async (input, init = {}) => {
      if (String(input).includes(".well-known/fonte-cli.json"))
        return json(hosted);
      if ((init.method ?? "GET") === "GET") return json(preflight());
      postCount += 1;
      throw new Error("synthetic lost response");
    }),
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(receipt.result, null);
  assert.equal(postCount, 1);
});

function argumentsForAppend(...extra) {
  return [
    "broadcast",
    "audience",
    "append",
    "--workspace",
    workspace,
    "--environment",
    "production",
    "--broadcast-id",
    broadcastId,
    "--frozen-audience-id",
    frozenAudienceId,
    "--identity-set-sha256",
    identitySetSha256,
    "--accepted-target-ceiling",
    "120",
    "--append-authorization-id",
    appendAuthorizationId,
    "--idempotency-key",
    idempotencyKey,
    ...extra,
  ];
}

function replaceArgument(name, replacement) {
  const result = argumentsForAppend();
  result[result.indexOf(name) + 1] = replacement;
  return result;
}

function preflight() {
  return {
    tenantId,
    environment: "production",
    baseline: { ...baseline },
    readback: audienceReadback(false),
  };
}

function appendReadback() {
  return {
    tenantId,
    environment: "production",
    ...audienceReadback(true),
  };
}

function audienceReadback(appended) {
  return {
    marketingBroadcastId: broadcastId,
    authorizationId: "199",
    requestedRecipientCount: appended ? 129 : 104,
    eligibleRecipientCount: appended ? 120 : 100,
    releasedRecipientCount: 100,
    acceptedRecipientCount: 99,
    heldRecipientCount: appended ? 20 : 0,
    controlState: "active",
    segments: [originalSegment(), ...(appended ? [appendSegment()] : [])],
  };
}

function originalSegment() {
  return {
    segment: "original",
    appendAuthorizationId: null,
    frozenAudienceId: existingFrozenAudienceId,
    canonicalIdentitySetSha256: null,
    sourceProvenance: [],
    recipientIndexStart: 0,
    sourceRecipientCount: 104,
    priorSegmentRecipientCount: 0,
    excludedRecipientCount: 1,
    protectedRecipientCount: 1,
    unknownRecipientCount: 2,
    eligibleRecipientCount: 100,
    acceptedTargetCeiling: null,
    releasedRecipientCount: 100,
    heldRecipientCount: 0,
    acceptedRecipientCount: 99,
    refusedRecipientCount: 0,
    indeterminateRecipientCount: 1,
    cancelledRecipientCount: 0,
    deliveredRecipientCount: 90,
    complainedRecipientCount: 0,
    acceptedEmailUsageQuantity: 99,
    createdAt: "2026-08-24T10:00:00.000Z",
  };
}

function appendSegment() {
  return {
    segment: "append",
    appendAuthorizationId,
    frozenAudienceId,
    canonicalIdentitySetSha256: identitySetSha256,
    sourceProvenance: {
      source: { provider: "resend", collectionId: "synthetic-segment" },
      exclusions: [],
      providerSecret: "synthetic-provider-secret",
      contact: { email: "hidden@example.test" },
    },
    recipientIndexStart: 100,
    sourceRecipientCount: 25,
    priorSegmentRecipientCount: 3,
    excludedRecipientCount: 1,
    protectedRecipientCount: 0,
    unknownRecipientCount: 1,
    eligibleRecipientCount: 20,
    acceptedTargetCeiling: 120,
    releasedRecipientCount: 0,
    heldRecipientCount: 20,
    acceptedRecipientCount: 0,
    refusedRecipientCount: 0,
    indeterminateRecipientCount: 0,
    cancelledRecipientCount: 0,
    deliveredRecipientCount: 0,
    complainedRecipientCount: 0,
    acceptedEmailUsageQuantity: 0,
    createdAt: "2026-08-24T10:01:00.000Z",
  };
}

function programDependencies(fetch, authorize = async () => bearer) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "30000000-0000-4000-8000-000000000205",
    runner: { run: async () => 1 },
    operator: {
      fetch,
      authorize,
      sleep: async () => undefined,
    },
  };
}

function coreRequest(input, init) {
  return {
    method: init.method ?? "GET",
    url: String(input),
    bearer: init.headers.authorization.replace("Bearer ", ""),
    idempotencyKey: init.headers["idempotency-key"] ?? null,
    body: init.body ? JSON.parse(init.body) : null,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
