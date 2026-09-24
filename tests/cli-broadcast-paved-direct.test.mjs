import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const draftId = "06e80284-2a96-498c-9a5f-d32e9993a671";
const preparedInput = {
  workspace: "demo-workspace",
  draft_id: draftId,
  expected_revision: 7,
  snapshot_sha256: "a".repeat(64),
  request_id: "17e994a1-4222-453c-865f-a6c632707ffc",
};

test("direct prepare parses product inputs and requires JSON output", () => {
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
      },
    },
  );
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
    { action: "send", input: preparedInput },
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
  assert.equal(sendResult.exitCode, 0);
  assert.deepEqual(JSON.parse(sendResult.stdout), sendReceipt);
  assert.deepEqual(calls.prepare, [
    {
      workspace_selector: "demo-workspace",
      draft_id: draftId,
      audience_file: "/tmp/recipients.csv",
    },
  ]);
  assert.deepEqual(calls.send, [preparedInput]);
  assert.equal(calls.runner, 0);
});
