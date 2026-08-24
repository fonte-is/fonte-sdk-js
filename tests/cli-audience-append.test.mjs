import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { createBrowserAuthorizationSession } from "../packages/cli/dist/oauth.js";
import { renderOperatorHuman } from "../packages/cli/dist/operator-render.js";
import { runProgram } from "../packages/cli/dist/program.js";

const workspace = "synthetic-audience";
const broadcastId = "30000000-0000-4000-8000-000000000199";
const frozenAudienceId = "30000000-0000-4000-8000-000000000200";
const existingFrozenAudienceId = "30000000-0000-4000-8000-000000000201";
const connectionId = "30000000-0000-4000-8000-000000000202";
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
  progressVersion: "synthetic-progress-7",
  acceptedRecipientCount: 100,
  refusedRecipientCount: 0,
  unknownRecipientCount: 1,
  cancelledRecipientCount: 1,
  segmentCount: 1,
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
    replaceArgument("--append-authorization-id", "x".repeat(101)),
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

test("one browser session preflights, posts the exact baseline, and reads back the same key", async () => {
  let prepared = 0;
  let opened = 0;
  const requests = [];
  let replayed = false;
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
      close: () => {},
    }),
    openBrowser: async () => {
      opened += 1;
      return true;
    },
  });
  const dependencies = programDependencies(async (input, init = {}) => {
    if (String(input).includes(".well-known/fonte-cli.json")) {
      return json(hosted);
    }
    requests.push(coreRequest(input, init));
    if ((init.method ?? "GET") === "GET") return json(preflight());
    const response = appendReadback(replayed);
    replayed = true;
    return json(response);
  }, authorization.authorize);

  const first = await runProgram(argumentsForAppend("--json"), dependencies);
  const second = await runProgram(argumentsForAppend("--json"), dependencies);
  const firstReceipt = JSON.parse(first.stdout);
  const secondReceipt = JSON.parse(second.stdout);

  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  assert.equal(prepared, 1);
  assert.equal(opened, 1);
  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      { method: "GET", url: `https://api.example.test${path}` },
      { method: "POST", url: `https://api.example.test${path}` },
      { method: "GET", url: `https://api.example.test${path}` },
      { method: "POST", url: `https://api.example.test${path}` },
    ],
  );
  for (const request of requests) assert.equal(request.bearer, bearer);
  for (const request of requests.filter(({ method }) => method === "POST")) {
    assert.equal(request.idempotencyKey, idempotencyKey);
    assert.deepEqual(request.body, {
      baseline,
      frozenAudienceId,
      identitySetSha256,
      acceptedTargetCeiling: 120,
      appendAuthorizationId,
      idempotencyKey,
    });
  }
  assert.equal(firstReceipt.reason, "broadcast_audience_append_completed");
  assert.equal(firstReceipt.core_effect, "created");
  assert.equal(secondReceipt.reason, "broadcast_audience_append_idempotent");
  assert.equal(secondReceipt.core_effect, "none");
  assert.equal(secondReceipt.result.idempotency_key, idempotencyKey);
  assert.deepEqual(Object.keys(firstReceipt.result).sort(), [
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
  assert.deepEqual(
    firstReceipt.result.segments[1].source_provenance,
    {
      provider: "resend",
      connection_id: connectionId,
      collection_type: "segment",
      collection_id: "synthetic-provider-segment",
    },
  );
  const human = renderOperatorHuman(firstReceipt);
  assert.match(human, /Accepted baseline\/target\/final: 100\/120\/120/);
  assert.match(human, /source resend\/segment\/synthetic-provider-segment/);
  assert.equal(human.includes("synthetic-provider-secret"), false);
  assert.equal(first.stdout.includes(bearer), false);
  assert.equal(first.stdout.includes("synthetic-memory-only-refresh"), false);
});

test("unknown or contact-shaped Core fields invalidate preflight and mutation receipts", async () => {
  let posts = 0;
  const invalidPreflight = await runProgram(
    argumentsForAppend("--json"),
    programDependencies(async (input, init = {}) => {
      if (String(input).includes(".well-known/fonte-cli.json")) {
        return json(hosted);
      }
      if ((init.method ?? "GET") === "POST") posts += 1;
      return json({ ...preflight(), contactRows: [{ email: "hidden" }] });
    }),
  );
  assert.equal(invalidPreflight.exitCode, 3);
  assert.equal(JSON.parse(invalidPreflight.stdout).reason, "core_operator_receipt_invalid");
  assert.equal(posts, 0);

  const invalidReadback = await runProgram(
    argumentsForAppend("--json"),
    programDependencies(async (input, init = {}) => {
      if (String(input).includes(".well-known/fonte-cli.json")) {
        return json(hosted);
      }
      return (init.method ?? "GET") === "GET"
        ? json(preflight())
        : json({
            ...appendReadback(false),
            providerPayload: { secret: "synthetic-provider-secret" },
          });
    }),
  );
  const receipt = JSON.parse(invalidReadback.stdout);
  assert.equal(invalidReadback.exitCode, 3);
  assert.equal(receipt.reason, "core_operator_receipt_invalid");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(invalidReadback.stdout.includes("synthetic-provider-secret"), false);
});

test("baseline conflict and append failure states remain distinct and fail closed", async () => {
  const cases = [
    { status: 404, reason: "ignored", expected: "broadcast_audience_append_not_found", failOn: "GET" },
    { status: 409, reason: "baseline_drift", expected: "broadcast_audience_append_conflict", failOn: "POST" },
    { status: 422, reason: "ignored", expected: "broadcast_audience_append_no_new_recipient", failOn: "POST" },
    { status: 503, reason: "ignored", expected: "broadcast_audience_append_unavailable", failOn: "GET" },
    { status: 401, reason: "ignored", expected: "human_auth_invalid", failOn: "GET" },
  ];
  for (const scenario of cases) {
    let postCount = 0;
    const result = await runProgram(
      argumentsForAppend("--json"),
      programDependencies(async (input, init = {}) => {
        if (String(input).includes(".well-known/fonte-cli.json")) {
          return json(hosted);
        }
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
      if (String(input).includes(".well-known/fonte-cli.json")) {
        return json(hosted);
      }
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
    environment: "production",
    marketingBroadcastId: broadcastId,
    baseline: { ...baseline },
  };
}

function appendReadback(replayed) {
  return {
    environment: "production",
    marketingBroadcastId: broadcastId,
    appendAuthorizationId,
    acceptedTargetCeiling: 120,
    idempotencyKey,
    replayed,
    baseline: { ...baseline },
    aggregate: {
      acceptedRecipientCount: 120,
      refusedRecipientCount: 0,
      unknownRecipientCount: 1,
      cancelledRecipientCount: 1,
      segmentCount: 2,
    },
    segments: [
      {
        index: 0,
        frozenAudienceId: existingFrozenAudienceId,
        identitySetSha256: existingIdentitySetSha256,
        acceptedRecipientCount: 100,
        sourceProvenance: null,
      },
      {
        index: 1,
        frozenAudienceId,
        identitySetSha256,
        acceptedRecipientCount: 20,
        sourceProvenance: {
          provider: "resend",
          connectionId,
          collectionType: "segment",
          collectionId: "synthetic-provider-segment",
        },
      },
    ],
  };
}

function programDependencies(fetch, authorize = async () => bearer) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "30000000-0000-4000-8000-000000000203",
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
