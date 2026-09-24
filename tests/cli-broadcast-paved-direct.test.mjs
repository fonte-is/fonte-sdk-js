import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import { createCoreRequester } from "../packages/cli/dist/operator-core-request.js";
import { runBroadcastDiagnosticStage } from "../packages/cli/dist/operator-broadcast-diagnostics.js";

const draftId = "06e80284-2a96-498c-9a5f-d32e9993a671";
const preparedInput = {
  workspace: "demo-workspace",
  draft_id: draftId,
  expected_revision: 7,
  snapshot_sha256: "a".repeat(64),
  request_id: "17e994a1-4222-453c-865f-a6c632707ffc",
};

test("direct Prepare accepts human, JSON, and verbose output modes", () => {
  assert.deepEqual(
    parseArguments([
      "broadcast",
      "prepare",
      "--workspace",
      "demo-workspace",
      "--draft-id",
      draftId,
      "--audience-file",
      "/tmp/recipients.csv",
      "--json",
    ]),
    {
      command: "broadcast-paved",
      apply: false,
      json: true,
      broadcastPaved: {
        action: "prepare",
        input: {
          workspace_selector: "demo-workspace",
          draft_id: draftId,
          audience_file: "/tmp/recipients.csv",
        },
        json: true,
        verbose: false,
      },
    },
  );
  assert.equal(parseArguments([
    "broadcast", "prepare", "--workspace", "demo-workspace", "--draft-id", draftId,
    "--audience-file", "/tmp/recipients.csv",
  ]).json, false);
  const verbose = parseArguments([
    "broadcast", "prepare", "--workspace", "demo-workspace", "--draft-id", draftId,
    "--audience-file", "/tmp/recipients.csv", "--verbose",
  ]);
  assert.equal(verbose.verbose, true);
  assert.equal(verbose.json, false);
  assert.equal(verbose.broadcastPaved.verbose, true);
  assert.throws(() =>
    parseArguments([
      "broadcast",
      "prepare",
      "--workspace",
      "demo-workspace",
      "--draft-id",
      draftId,
      "--audience-file",
      "recipients.csv",
      "--json",
    ]),
  );
});

test("direct send accepts only the exact structured send_input", () => {
  assert.deepEqual(
    parseArguments([
      "broadcast",
      "send",
      "--send-input",
      JSON.stringify(preparedInput),
      "--json",
    ]).broadcastPaved,
    { action: "send", input: preparedInput, json: true, verbose: false },
  );
  assert.throws(() =>
    parseArguments([
      "broadcast",
      "send",
      "--send-input",
      JSON.stringify({ ...preparedInput, bearer: "secret" }),
      "--json",
    ]),
  );
});

test("direct CLI dispatches Prepare and Send through only the paved operator", async () => {
  const calls = { prepare: [], send: [], runner: 0 };
  const prepared = {
    status: "ready_to_send",
    draft_id: draftId,
    revision: 7,
    summary: "Ready; no Send was attempted.",
    missing: [],
    choices: [],
    warnings: [],
    send_input: preparedInput,
  };
  const sendReceipt = {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: "broadcast_send_now",
    outcome: "queued",
    reason: "broadcast_send_queued",
    workspace: "demo-workspace",
    authority: {
      status: "current",
      contract_id: "fonte.core.broadcast_send_instruction.v3",
    },
    core_effect: "queued",
    result: null,
  };
  const dependencies = {
    cwd: "/tmp",
    randomUUID: () => "17e994a1-4222-453c-865f-a6c632707ffc",
    runner: {
      run: async () => {
        calls.runner += 1;
        return 0;
      },
    },
    broadcastPaved: {
      prepare: async (input) => {
        calls.prepare.push(input);
        return prepared;
      },
      send: async (input) => {
        calls.send.push(input);
        return sendReceipt;
      },
    },
  };

  const prepareResult = await runProgram(
    [
      "broadcast",
      "prepare",
      "--workspace",
      "demo-workspace",
      "--draft-id",
      draftId,
      "--audience-file",
      "/tmp/recipients.csv",
      "--json",
    ],
    dependencies,
  );
  const sendResult = await runProgram(
    [
      "broadcast",
      "send",
      "--send-input",
      JSON.stringify(prepared.send_input),
      "--json",
    ],
    dependencies,
  );

  assert.equal(prepareResult.exitCode, 0);
  assert.deepEqual(JSON.parse(prepareResult.stdout), prepared);
  assert.equal(prepareResult.stderr, "");
  assert.equal(sendResult.exitCode, 0);
  assert.deepEqual(JSON.parse(sendResult.stdout), sendReceipt);
  assert.equal(sendResult.stderr, "");
  assert.deepEqual(calls.prepare, [
    {
      workspace_selector: "demo-workspace",
      draft_id: draftId,
      audience_file: "/tmp/recipients.csv",
    },
  ]);
  assert.deepEqual(calls.send, [preparedInput]);
  assert.equal(calls.runner, 0);

  const humanResult = await runProgram([
    "broadcast", "prepare", "--workspace", "demo-workspace", "--draft-id", draftId,
    "--audience-file", "/tmp/recipients.csv",
  ], dependencies);
  assert.equal(humanResult.stdout,
    "Fonte Broadcast preparation: ready to send.\nDraft revision: 7.\nNo Send or Test Send was attempted.\n",
  );
  assert.match(humanResult.stdout, /Fonte Broadcast preparation: ready to send\./u);
  assert.equal(humanResult.stderr, "");

  const jsonVerboseResult = await runProgram([
    "broadcast", "prepare", "--workspace", "demo-workspace", "--draft-id", draftId,
    "--audience-file", "/tmp/recipients.csv", "--json", "--verbose",
  ], dependencies);
  assert.equal(jsonVerboseResult.stdout, `${JSON.stringify(prepared)}\n`);
  assert.match(jsonVerboseResult.stderr, /prepare\.total \d+ms/u);
  assert.match(jsonVerboseResult.stderr, /prepare\.failed_at none/u);
});

test("verbose Prepare prints safe Core diagnostics without request secrets", async () => {
  const bearer = "bearer-secret-sentinel";
  const bodySentinel = "private-response-body-sentinel";
  const csvSecret = "csv-row-secret-sentinel";
  const contentSecret = "email-content-secret-sentinel";
  const paymentSecret = "payment-secret-sentinel";
  const emailSecret = "recipient-secret@example.test";
  const workspaceId = "private-workspace-sentinel";
  const draftPathId = "11111111-1111-4111-8111-111111111111";
  const setPathId = "22222222-2222-4222-8222-222222222222";
  const readRequest = createCoreRequester({
    coreApiBaseUrl: "https://core.example.test",
    bearer,
    fetch: async (_url, init) => {
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${bearer}`);
      return new Response(JSON.stringify({
        error: "oauth_client_route_denied",
        private: [bodySentinel, emailSecret],
      }), { status: 403 });
    },
  });
  const readResult = await runProgram([
    "broadcast", "prepare", "--workspace", "demo-workspace", "--draft-id", draftId,
    "--audience-file", "/tmp/recipients.csv", "--verbose",
  ], {
    cwd: "/tmp",
    randomUUID: () => preparedInput.request_id,
    runner: { run: async () => 0 },
    broadcastPaved: {
      prepare: async () => runBroadcastDiagnosticStage("recipient_set_read", () =>
        readRequest(`/v1/workspaces/${workspaceId}/broadcast-drafts/${draftPathId}` +
          `/recipient-sets/${setPathId}?environment=production`),
      ),
      send: async () => { throw new Error("unused"); },
    },
  });
  assert.match(readResult.stderr,
    /prepare\.recipient_set_read\s+\d+ms\s+GET \/v1\/workspaces\/:workspace\/broadcast-drafts\/:draft_id\/recipient-sets\/:recipient_set_id 403 oauth_client_route_denied core_effect=none/u,
  );
  assert.match(readResult.stderr, /prepare\.failed_at recipient_set_read/u);
  assert.match(readResult.stderr, /prepare\.total \d+ms/u);

  const createRequest = createCoreRequester({
    coreApiBaseUrl: "https://core.example.test",
    bearer,
    fetch: async (_url, init) => {
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${bearer}`);
      assert.match(String(init.body), new RegExp(csvSecret, "u"));
      return new Response(JSON.stringify({
        error: "broadcast_recipient_set_create_denied",
        private: [contentSecret, paymentSecret],
      }), { status: 400 });
    },
  });
  const createResult = await runProgram([
    "broadcast", "prepare", "--workspace", "demo-workspace", "--draft-id", draftId,
    "--audience-file", "/tmp/recipients.csv", "--verbose",
  ], {
    cwd: "/tmp",
    randomUUID: () => preparedInput.request_id,
    runner: { run: async () => 0 },
    broadcastPaved: {
      prepare: async () => runBroadcastDiagnosticStage("recipient_set_create", () =>
        createRequest(`/v1/workspaces/${workspaceId}/broadcast-drafts/${draftPathId}/recipient-sets`, {
          body: { csvText: csvSecret, html: contentSecret, paymentToken: paymentSecret },
          lostResponseEffect: "unknown",
        }),
      ),
      send: async () => { throw new Error("unused"); },
    },
  });
  assert.match(createResult.stderr,
    /prepare\.recipient_set_create\s+\d+ms\s+POST \/v1\/workspaces\/:workspace\/broadcast-drafts\/:draft_id\/recipient-sets 400 broadcast_recipient_set_create_denied core_effect=none/u,
  );
  for (const secret of [bearer, bodySentinel, csvSecret, contentSecret, paymentSecret,
    emailSecret, workspaceId, draftPathId, setPathId]) {
    assert.equal(`${readResult.stdout}${readResult.stderr}${createResult.stdout}${createResult.stderr}`.includes(secret), false);
  }
  const timings = [...readResult.stderr.matchAll(/\b(\d+)ms\b/gu)].map((match) => Number(match[1]));
  assert.ok(timings.length >= 2);
  assert.ok(timings.every((value) => Number.isFinite(value) && value >= 0));
});
