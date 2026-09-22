import assert from "node:assert/strict";
import test from "node:test";

import { registerMcpBroadcastSendInstructionTools } from "../packages/cli/dist/mcp-broadcast-send-instruction-registration.js";
import {
  createBroadcastSendNowToolHandler,
  createBroadcastSendReadToolHandler,
  createBroadcastSpendLimitIncreaseToolHandler,
} from "../packages/cli/dist/mcp-broadcast-send-instruction-tools.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000711";
const requestId = "00000000-0000-4000-8000-000000000712";

test("MCP registers one-effect Send/Schedule, GET observation, and bounded controls", () => {
  const registrations = [];
  registerMcpBroadcastSendInstructionTools(
    {
      registerTool: (...args) => registrations.push(args),
    },
    async () => client(),
  );
  assert.deepEqual(
    registrations.map(([name]) => name),
    [
      "fonte_send_broadcast_now",
      "fonte_schedule_broadcast",
      "fonte_read_broadcast_send_operation",
      "fonte_replace_broadcast_schedule",
      "fonte_cancel_broadcast_send",
      "fonte_increase_broadcast_spend_limit",
    ],
  );
  const read = registrations.find(
    ([name]) => name === "fonte_read_broadcast_send_operation",
  );
  assert.equal(read[1].annotations.readOnlyHint, true);
  assert.equal(read[1].annotations.destructiveHint, false);
  for (const registration of registrations.filter(
    ([name]) => name !== "fonte_read_broadcast_send_operation",
  )) {
    assert.equal(registration[1].annotations.readOnlyHint, false);
    assert.equal(registration[1].annotations.idempotentHint, true);
  }
  assert.match(read[1].description, /GET only/);
  assert.match(read[1].description, /Preparing/);
});

test("MCP Send now maps one explicit direction to one v3 acceptance", async () => {
  const calls = [];
  const handler = createBroadcastSendNowToolHandler(async () => ({
    ...client(),
    acceptBroadcastSend: async (input) => {
      calls.push(input);
      return result("queued");
    },
  }));
  const output = await handler({
    workspace,
    draft_id: draftId,
    request_id: requestId,
    expected_draft_version: 4,
  });
  assert.equal(output.outcome, "completed");
  assert.equal(output.operation.operation.phase, "queued");
  assert.deepEqual(calls, [
    {
      workspace,
      draftId,
      requestId,
      expectedDraftVersion: 4,
      timing: { mode: "now" },
    },
  ]);
});

test("MCP observation cannot become a mutation and preserves unavailable evidence", async () => {
  let reads = 0;
  const handler = createBroadcastSendReadToolHandler(async () => ({
    ...client(),
    readBroadcastSendOperation: async (input) => {
      reads += 1;
      assert.deepEqual(input, { workspace, draftId });
      return result("preparing");
    },
  }));
  const output = await handler({ workspace, draft_id: draftId });
  assert.equal(reads, 1);
  assert.equal(output.operation.operation.total, null);
  assert.equal(output.operation.operation.delivery.status, "unavailable");
  assert.equal(
    output.operation.operation.delivery.reason,
    "provider_submission_not_started",
  );
});

test("MCP failures preserve denial, conflict, and ambiguous-effect truth", async () => {
  for (const [error, expected] of [
    [
      new CoreOperatorError("human_auth_workspace_access_denied", 403, "none"),
      "denied",
    ],
    [
      new CoreOperatorError("broadcast_draft_version_conflict", 409, "none"),
      "conflict",
    ],
    [
      new CoreOperatorError("core_api_unavailable", null, "unknown"),
      "ambiguous",
    ],
  ]) {
    const handler = createBroadcastSendNowToolHandler(async () => ({
      ...client(),
      acceptBroadcastSend: async () => {
        throw error;
      },
    }));
    const output = await handler({
      workspace,
      draft_id: draftId,
      request_id: requestId,
      expected_draft_version: 4,
    });
    assert.equal(output.outcome, expected);
    assert.equal(output.core_effect, error.coreEffect);
    assert.equal(output.operation, null);
  }
});

test("MCP spend-limit action delegates the exact same-operation resolver", async () => {
  const calls = [];
  const handler = createBroadcastSpendLimitIncreaseToolHandler(async () => ({
    ...client(),
    resolveBroadcastSpendLimit: async (input) => {
      calls.push(input);
      return result("queued", 2);
    },
  }));
  const output = await handler({
    workspace,
    draft_id: draftId,
    request_id: requestId,
    expected_instruction_generation: 1,
    expected_approval_generation: 1,
  });
  assert.equal(output.operation.operation.approval_generation, 2);
  assert.deepEqual(calls, [
    {
      workspace,
      draftId,
      requestId,
      expectedInstructionGeneration: 1,
      expectedApprovalGeneration: 1,
    },
  ]);
});

function client() {
  return {
    acceptBroadcastSend: async () => result("queued"),
    readBroadcastSendOperation: async () => result("queued"),
    replaceBroadcastSendSchedule: async () => result("scheduled"),
    cancelBroadcastSend: async () => result("canceled"),
    amendBroadcastSendApproval: async () => result("queued", 2),
    resolveBroadcastSpendLimit: async () => result("queued", 2),
  };
}

function result(phase, approvalGeneration = 1) {
  return {
    kind: "broadcast_send_operation",
    status: "accepted",
    operation: {
      schema: "broadcast_send_operation.v2",
      operation_id: "00000000-0000-4000-8000-000000000713",
      workspace_id: "workspace-internal",
      environment: "production",
      draft_id: draftId,
      instruction_generation: 1,
      approval_generation: approvalGeneration,
      accepted_at: "2026-09-22T15:00:00.000Z",
      timing: { mode: "now" },
      not_before: "2026-09-22T15:00:00.000Z",
      phase,
      reason: null,
      retryable: true,
      next_attempt_at: "2026-09-22T15:00:01.000Z",
      total: null,
      timestamps: {
        preparation_started_at: null,
        snapshot_at: null,
        authorization_committed_at: null,
        first_submission_at: null,
        terminal_at: null,
      },
      delivery: {
        status: "unavailable",
        reason: "provider_submission_not_started",
        observed_at: null,
      },
      required_action: null,
      allowed_actions: phase === "canceled" ? [] : ["cancel"],
      execution_authorized: false,
      replayed: false,
    },
  };
}
