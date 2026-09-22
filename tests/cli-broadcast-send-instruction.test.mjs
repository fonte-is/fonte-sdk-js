import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { createBroadcastSendInstructionClient } from "../packages/cli/dist/operator-broadcast-send-instruction-client.js";
import { executeBroadcastSendInstructionCommand } from "../packages/cli/dist/operator-broadcast-send-instruction-run.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  draftId,
  envelope,
  json,
  operation,
  operationId,
  path,
  requestId,
  workspace,
} from "./fixtures/broadcast-send-instruction.mjs";

test("CLI grammar makes Send now and Schedule one explicit digest-free effect", () => {
  assert.deepEqual(
    parseArguments([
      "broadcast",
      "send",
      "now",
      "--workspace",
      workspace,
      "--environment",
      "production",
      "--draft-id",
      draftId,
      "--expected-version",
      "7",
      "--request-id",
      requestId,
      "--json",
    ]).operator,
    {
      kind: "broadcast_send_now",
      workspace,
      draftId,
      expectedDraftVersion: 7,
      requestId,
    },
  );
  assert.deepEqual(
    parseArguments([
      "broadcast",
      "send",
      "schedule",
      "--workspace",
      workspace,
      "--environment",
      "production",
      "--draft-id",
      draftId,
      "--expected-version",
      "7",
      "--not-before",
      "2026-10-01T12:00:00.000Z",
      "--request-id",
      requestId,
    ]).operator,
    {
      kind: "broadcast_schedule",
      workspace,
      draftId,
      expectedDraftVersion: 7,
      requestId,
      notBefore: "2026-10-01T12:00:00.000Z",
    },
  );
  for (const forbidden of [
    "--accepted-instruction-digest",
    "--commercial-basis-digest",
    "--review-id",
  ]) {
    assert.throws(() =>
      parseArguments([
        "broadcast",
        "send",
        "now",
        "--workspace",
        workspace,
        "--environment",
        "production",
        "--draft-id",
        draftId,
        "--expected-version",
        "7",
        "--request-id",
        requestId,
        forbidden,
        `sha256:${"a".repeat(64)}`,
      ]),
    );
  }
});

test("client sends the exact v3 command and all status reads remain GET-only", async () => {
  const requests = [];
  const client = createBroadcastSendInstructionClient(
    async (requestPath, options) => {
      requests.push({ path: requestPath, options });
      return envelope(operation({ replayed: requests.length > 1 }));
    },
  );
  const input = {
    workspace,
    draftId,
    requestId,
    expectedDraftVersion: 7,
    timing: { mode: "now" },
  };
  const first = await client.acceptBroadcastSend(input);
  const replay = await client.acceptBroadcastSend(input);
  assert.equal(first.operation.operation_id, operationId);
  assert.equal(replay.operation.replayed, true);
  assert.deepEqual(
    requests.map(({ path: value }) => value),
    [`${path}?environment=production`, `${path}?environment=production`],
  );
  assert.deepEqual(requests[0].options.body, {
    schema: "broadcast_send_intent.v3",
    requestId,
    executionRail: "canonical_execution_cell_v1",
    expectedDraftVersion: 7,
    timing: { mode: "now" },
  });
  assert.equal(JSON.stringify(requests).includes("Digest"), false);

  let reads = 0;
  const methods = [];
  const readClient = createBroadcastSendInstructionClient(
    async (requestPath, options) => {
      methods.push({ requestPath, options });
      reads += 1;
      return envelope(
        operation({ phase: reads === 1 ? "preparing" : "complete" }),
      );
    },
  );
  const observed = await executeBroadcastSendInstructionCommand(
    {
      kind: "broadcast_send_status",
      workspace,
      draftId,
      watch: true,
    },
    readClient,
    async () => undefined,
  );
  assert.equal(observed.operation.phase, "complete");
  assert.equal(reads, 2);
  assert.ok(
    methods.every(
      ({ requestPath, options }) =>
        requestPath === `${path}?environment=production` &&
        options === undefined,
    ),
  );
});

test("installed CLI framing reports HTTP 202 as Queued, never Sending", async () => {
  const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
  const calls = [];
  const result = await runProgram(
    [
      "broadcast",
      "send",
      "now",
      "--workspace",
      workspace,
      "--environment",
      "production",
      "--draft-id",
      draftId,
      "--expected-version",
      "7",
      "--request-id",
      requestId,
      "--json",
    ],
    {
      cwd: process.cwd(),
      randomUUID: () => "00000000-0000-4000-8000-000000000799",
      runner: { run: async () => 1 },
      operator: {
        configUrl,
        authorize: async () => "synthetic.header.signature",
        sleep: async () => undefined,
        fetch: async (input, init = {}) => {
          calls.push({ input: String(input), init });
          if (String(input) === configUrl)
            return json({
              schema: "fonte.cli.hosted_config.v1",
              authorizationServer: "https://identity.example.test/auth/v1",
              clientId: "fonte-cli-client-v0",
              coreApiBaseUrl: "https://api.example.test",
              redirectUri: "http://127.0.0.1:49671/callback",
              scopes: ["email"],
            });
          return json(envelope(operation()), 202);
        },
      },
    },
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 0);
  assert.equal(receipt.outcome, "queued");
  assert.equal(receipt.reason, "broadcast_send_queued");
  assert.equal(receipt.result.operation.phase, "queued");
  assert.equal(receipt.result.operation.total, null);
  assert.equal(
    receipt.authority.contract_id,
    "fonte.core.broadcast_send_instruction.v3",
  );
  assert.equal(calls[1].init.method, "POST");
  assert.equal(
    calls[1].init.headers.authorization,
    "Bearer synthetic.header.signature",
  );
});
