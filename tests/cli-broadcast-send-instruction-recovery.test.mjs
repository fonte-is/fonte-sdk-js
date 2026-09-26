import assert from "node:assert/strict";
import test from "node:test";

import { createBroadcastSendInstructionClient } from "../packages/cli/dist/operator-broadcast-send-instruction-client.js";
import {
  createCoreRequester,
  CoreOperatorError,
} from "../packages/cli/dist/operator-core-request.js";
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

test("a lost response retries with the same request and a fresh client recovers one operation", async () => {
  const bodies = [];
  let lose = true;
  const requester = createCoreRequester({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic.header.signature",
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(init.body));
      if (lose) {
        lose = false;
        throw new Error("response lost");
      }
      return json(envelope(operation({ replayed: true })), 200);
    },
  });
  const input = {
    workspace,
    draftId,
    requestId,
    expectedDraftVersion: 7,
    timing: { mode: "now" },
  };
  await assert.rejects(
    createBroadcastSendInstructionClient(requester).acceptBroadcastSend(input),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "core_api_unavailable" &&
      error.coreEffect === "unknown",
  );
  const recovered =
    await createBroadcastSendInstructionClient(requester).acceptBroadcastSend(
      input,
    );
  assert.equal(recovered.operation.operation_id, operationId);
  assert.equal(recovered.operation.replayed, true);
  assert.deepEqual(bodies[0], bodies[1]);

  const fresh = createBroadcastSendInstructionClient(
    async (requestPath, options) => {
      assert.equal(requestPath, `${path}?environment=production`);
      assert.equal(options, undefined);
      return envelope(operation({ replayed: false }));
    },
  );
  assert.equal(
    (await fresh.readBroadcastSendOperation({ workspace, draftId })).operation
      .operation_id,
    operationId,
  );
});

test("Core authorization and saved-version denials pass through without fallback", async () => {
  for (const [status, reason] of [
    [401, "human_auth_invalid"],
    [403, "human_auth_workspace_access_denied"],
    [409, "broadcast_draft_version_conflict"],
    [409, "commercial_payer_subject_mismatch"],
  ]) {
    const requester = createCoreRequester({
      coreApiBaseUrl: "https://api.example.test",
      bearer: "synthetic.header.signature",
      fetch: async () => json({ error: reason }, status),
    });
    await assert.rejects(
      createBroadcastSendInstructionClient(requester).acceptBroadcastSend({
        workspace,
        draftId,
        requestId,
        expectedDraftVersion: 7,
        timing: { mode: "now" },
      }),
      (error) =>
        error instanceof CoreOperatorError &&
        error.reason === reason &&
        error.coreEffect === "none",
    );
  }
});

test("a mutation cannot claim success from an absent operation envelope", async () => {
  const client = createBroadcastSendInstructionClient(async () => ({
    status: "absent",
  }));
  await assert.rejects(
    client.acceptBroadcastSend({
      workspace,
      draftId,
      requestId,
      expectedDraftVersion: 7,
      timing: { mode: "now" },
    }),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "core_operator_receipt_invalid" &&
      error.coreEffect === "unknown",
  );
});

test("revision and cancellation use only exact generation-fenced routes", async () => {
  const requests = [];
  const client = createBroadcastSendInstructionClient(
    async (requestPath, options) => {
      requests.push({ requestPath, options });
      return envelope(
        operation({
          instructionGeneration: requestPath.includes("revisions") ? 2 : 1,
          phase: requestPath.includes("cancel") ? "canceled" : "scheduled",
        }),
      );
    },
  );
  await client.replaceBroadcastSendSchedule({
    workspace,
    draftId,
    requestId,
    expectedInstructionGeneration: 1,
    expectedDraftVersion: 8,
    notBefore: "2026-10-02T12:00:00.000Z",
  });
  await client.cancelBroadcastSend({
    workspace,
    draftId,
    requestId,
    expectedInstructionGeneration: 2,
  });
  assert.deepEqual(
    requests.map(({ requestPath }) => requestPath),
    [
      `${path}/revisions?environment=production`,
      `${path}/cancel?environment=production`,
    ],
  );
  assert.equal(JSON.stringify(requests).includes("send-approvals"), false);
  assert.equal(
    JSON.stringify(requests).includes("send-instruction-review"),
    false,
  );
});

test("structured spend-limit recovery uses Core's minimum and resumes the same operation", async () => {
  const requests = [];
  const client = createBroadcastSendInstructionClient(
    async (requestPath, options) => {
      requests.push({ requestPath, options });
      if (
        requestPath.endsWith("/billing/payment-method?environment=production")
      ) {
        return { emailBalance: { spendingCapMinor: 12_345 } };
      }
      if (options === undefined) {
        return envelope(
          operation({
            phase: "action_required",
            allowedActions: ["increase_spend_limit"],
            requiredAction: {
              kind: "increase_account_spend_limit",
              billingAccountId: "billing-account",
              currency: "USD",
              currentMaximumMinor: 10_000,
              minimumMaximumMinor: 12_345,
            },
          }),
        );
      }
      return envelope(operation({ approvalGeneration: 2, phase: "queued" }));
    },
  );
  const result = await client.resolveBroadcastSpendLimit({
    workspace,
    draftId,
    requestId,
    expectedInstructionGeneration: 1,
    expectedApprovalGeneration: 1,
  });
  assert.equal(result.operation.operation_id, operationId);
  assert.equal(result.operation.approval_generation, 2);
  assert.deepEqual(
    requests.map(({ requestPath }) => requestPath),
    [
      `${path}?environment=production`,
      `/v1/workspaces/${workspace}/billing/payment-method?environment=production`,
      `${path}/approval?environment=production`,
    ],
  );
  assert.deepEqual(requests[1].options.body, {
    operation: "spending_cap_update",
    spendingCapMinor: 12_345,
  });
  assert.deepEqual(requests[2].options.body, {
    schema: "broadcast_send_approval_amendment.v1",
    requestId,
    expectedInstructionGeneration: 1,
    expectedApprovalGeneration: 1,
  });
});

test("changed Commercial action fails before billing or approval mutation", async () => {
  let calls = 0;
  const client = createBroadcastSendInstructionClient(async () => {
    calls += 1;
    return envelope(operation({ phase: "queued" }));
  });
  await assert.rejects(
    client.resolveBroadcastSpendLimit({
      workspace,
      draftId,
      requestId,
      expectedInstructionGeneration: 1,
      expectedApprovalGeneration: 1,
    }),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "broadcast_spend_limit_action_changed" &&
      error.coreEffect === "none",
  );
  assert.equal(calls, 1);
});
