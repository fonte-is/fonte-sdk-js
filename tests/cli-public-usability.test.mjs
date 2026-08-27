import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { withAmbiguousBroadcastRecovery } from "../packages/cli/dist/operator-broadcast-recovery.js";
import { renderOperatorHuman } from "../packages/cli/dist/operator-render.js";
import { runProgram } from "../packages/cli/dist/program.js";

const workspace = "northstar";
const broadcastId = "10000000-0000-4000-8000-000000000201";
const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "http://127.0.0.1:43112",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const readback =
  `fonte broadcast status --workspace ${workspace} ` +
  `--environment production --broadcast-id ${broadcastId} --json`;

test("ambiguous control response has exact readback and forbids mutation retry", async () => {
  let controlRequests = 0;
  const result = await runProgram(
    [
      "broadcast",
      "pause",
      "--workspace",
      workspace,
      "--environment",
      "production",
      "--broadcast-id",
      broadcastId,
      "--expected-control-version",
      "4",
      "--json",
    ],
    {
      cwd: process.cwd(),
      randomUUID: () => "10000000-0000-4000-8000-000000000299",
      runner: { run: async () => 1 },
      operator: {
        configUrl,
        fetch: async (input) => {
          if (String(input) === configUrl) return json(config);
          controlRequests += 1;
          throw new Error("response lost after request");
        },
        authorize: async () => "header.payload.signature",
        sleep: async () => {},
      },
    },
  );

  assert.equal(result.exitCode, 3);
  assert.equal(controlRequests, 1);
  assert.deepEqual(result.receipt, {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: "broadcast_control",
    outcome: "blocked",
    reason: "core_api_unavailable",
    workspace,
    authority: {
      status: "current",
      contract_id: "fonte.core.production_broadcast.v1",
    },
    core_effect: "unknown",
    next_action: {
      kind: "run_command",
      command: readback,
      retry_mutation: false,
    },
    result: null,
  });
  assert.equal(
    renderOperatorHuman(result.receipt),
    [
      "Fonte production broadcast operation could not continue.",
      "Reason: core_api_unavailable.",
      "Core effect: unknown.",
      `Authoritative readback: ${readback}.`,
      "Do not retry the mutation.",
      "",
    ].join("\n"),
  );
});

test("ambiguous canary renderer keeps unknown effect and exact recovery", () => {
  const receipt = withAmbiguousBroadcastRecovery(
    { kind: "broadcast_canary", workspace, broadcastId },
    {
      schema_version: "fonte.cli.operator_receipt.v1",
      command: "broadcast_canary",
      outcome: "blocked",
      reason: "operator_request_failed",
      workspace,
      authority: {
        status: "current",
        contract_id: "fonte.core.production_broadcast.v1",
      },
      core_effect: "unknown",
      result: {
        kind: "broadcast_canary",
        operation_id: "10000000-0000-4000-8000-000000000202",
        broadcast_id: broadcastId,
        environment: "production",
        release_ceiling: 1,
        authorization: {
          status: "released",
          started_at: "2030-01-01T00:00:00.000Z",
          ended_at: "2030-01-01T00:01:00.000Z",
          bearer_persisted: false,
        },
        completed_steps: ["read_baseline"],
        baseline: null,
        final: null,
      },
    },
  );

  assert.deepEqual(receipt.next_action, {
    kind: "run_command",
    command: readback,
    retry_mutation: false,
  });
  const human = renderOperatorHuman(receipt);
  assert.match(human, /Core effect: unknown\./);
  assert.match(
    human,
    new RegExp(`Authoritative readback: ${escapeRegex(readback)}\\.`),
  );
  assert.match(human, /Do not retry the mutation\./);
});

test("packed public docs define invitation custody and exact replay/readback", async () => {
  const [readme, contract] = await Promise.all([
    readFile(new URL("../packages/cli/README.md", import.meta.url), "utf8"),
    readFile(
      new URL("../packages/cli/OPERATOR_CONTRACT.md", import.meta.url),
      "utf8",
    ),
  ]);
  for (const required of [
    "createWorkspaceInvitation",
    "claimWorkspaceInvitation",
    "listWorkspaceContexts",
    "invitation_token",
    "replayed: true",
    "grant_created: false",
    "same token, workspace, and environment",
    "must never enter\nURLs",
    "no invitation-create readback route",
  ]) {
    assert.match(readme, new RegExp(escapeRegex(required)));
  }
  assert.match(contract, /core_effect: "unknown"/);
  assert.match(contract, /retry_mutation: false/);
  assert.match(contract, /only sanctioned next step/);
});

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
