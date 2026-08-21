import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const draftId = "10000000-0000-4000-8000-000000000101";
const testId = "10000000-0000-4000-8000-000000000102";
const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "http://127.0.0.1:43112",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("sandbox test grammar binds workspace, revision, and idempotency", () => {
  assert.deepEqual(
    parseArguments([
      "broadcast",
      "test",
      "send",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--draft-id",
      draftId,
      "--revision",
      "3",
      "--idempotency-key",
      "sandbox-test-3",
      "--json",
    ]),
    {
      command: "operator",
      apply: false,
      json: true,
      operator: {
        kind: "broadcast_test_send",
        workspace: "northstar",
        draftId,
        revision: 3,
        idempotencyKey: "sandbox-test-3",
      },
    },
  );
  assert.throws(() =>
    parseArguments([
      "broadcast",
      "test",
      "send",
      "--workspace",
      "northstar",
      "--environment",
      "production",
      "--draft-id",
      draftId,
      "--revision",
      "3",
      "--idempotency-key",
      "sandbox-test-3",
    ]),
  );
});

test("every absent broadcast and Bridge declaration is generically unsupported", async () => {
  for (const argv of [
    ["broadcast", "prepare"],
    ["broadcast", "send"],
    ["broadcast", "reconcile"],
    ["broadcast", "watch"],
    ["broadcast", "duplicate"],
    ["bridge", "observe", "kit"],
    ["bridge", "status"],
    ["bridge", "diff"],
    ["bridge", "placement-plan"],
    ["bridge", "copy", "kit", "--json"],
  ]) {
    let calls = 0;
    const result = await runProgram(
      argv,
      dependencies(
        async () => {
          calls += 1;
          throw new Error("must not request");
        },
        async () => {
          calls += 1;
          throw new Error("must not authorize");
        },
      ),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(calls, 0);
    assert.equal(result.receipt.outcome, "unsupported_authority");
    assert.equal(result.receipt.reason, "unsupported_authority");
    assert.equal(result.receipt.command, "unsupported");
    assert.equal(result.receipt.core_effect, "none");
    assert.equal(result.receipt.result, null);
  }
});

test("sandbox queue uses the ephemeral bearer and emits no recipient or provider payload", async () => {
  const requests = [];
  const bearer = "header.payload.signature";
  const result = await runProgram(
    [
      "broadcast",
      "test",
      "send",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--draft-id",
      draftId,
      "--revision",
      "3",
      "--idempotency-key",
      "sandbox-test-3",
      "--json",
    ],
    dependencies(
      async (input, init = {}) => {
        requests.push({ url: String(input), init });
        if (String(input) === configUrl) return json(config);
        return json(
          {
            sandboxEmailId: testId,
            status: "queued",
            recipient: {
              kind: "verified_account_email",
              email: "hidden@example.test",
            },
            replayed: false,
          },
          201,
        );
      },
      async () => bearer,
    ),
  );

  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(receipt.outcome, "queued");
  assert.equal(receipt.result.test_id, testId);
  const request = requests[1];
  assert.equal(request.init.headers.authorization, `Bearer ${bearer}`);
  assert.equal(request.init.headers["idempotency-key"], "sandbox-test-3");
  assert.deepEqual(JSON.parse(request.init.body), {
    broadcastDraftId: draftId,
    draftVersion: 3,
    idempotencyKey: "sandbox-test-3",
  });
  for (const forbidden of [
    bearer,
    "hidden@example.test",
    "recipient",
    "provider",
  ]) {
    assert.equal(result.stdout.includes(forbidden), false);
  }
});

test("sandbox watch returns exact sanitized terminal counts", async () => {
  let reads = 0;
  const sleeps = [];
  const result = await runProgram(
    [
      "broadcast",
      "test",
      "status",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--test-id",
      testId,
      "--watch",
      "--json",
    ],
    dependencies(
      async (input) => {
        if (String(input) === configUrl) return json(config);
        reads += 1;
        return json({
          sandboxEmailId: testId,
          status: reads === 1 ? "processing" : "terminal",
          pollAfterMilliseconds: reads === 1 ? 25 : null,
          provider: {
            acceptedCount: reads === 1 ? 0 : 1,
            refusedCount: 0,
            unknownCount: 0,
            messageId: "provider-secret-id",
          },
          billing: { quantity: reads === 1 ? null : 1 },
        });
      },
      async () => "header.payload.signature",
      async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    ),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(reads, 2);
  assert.deepEqual(sleeps, [25]);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, "terminal");
  assert.equal(receipt.result.accepted_count, 1);
  assert.equal(receipt.result.refused_count, 0);
  assert.equal(receipt.result.unknown_count, 0);
  assert.equal(receipt.result.accepted_email_usage_quantity, 1);
  assert.equal(result.stdout.includes("provider-secret-id"), false);
});

test("lost mutation response reports unknown Core effect", async () => {
  const result = await runProgram(
    [
      "broadcast",
      "test",
      "send",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--draft-id",
      draftId,
      "--revision",
      "3",
      "--idempotency-key",
      "sandbox-test-3",
      "--json",
    ],
    dependencies(
      async (input) => {
        if (String(input) === configUrl) return json(config);
        throw new Error("response lost");
      },
      async () => "header.payload.signature",
    ),
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
});

function dependencies(fetcher, authorize, sleep = async () => undefined) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000199",
    runner: { run: async () => 1 },
    operator: { configUrl, fetch: fetcher, authorize, sleep },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
