import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { broadcastRender } from "./operator-broadcast-render-json.js";
import {
  requireProofInput,
  sameProof,
} from "./operator-broadcast-render-values.js";
import {
  broadcastTestRequest,
  broadcastTestResult,
} from "./operator-broadcast-test-json.js";
import type {
  BroadcastDraftRenderInput,
  BroadcastDraftRenderResult,
  BroadcastTestReadInput,
  BroadcastTestRequestInput,
  BroadcastTestRequestResult,
  BroadcastTestResult,
} from "./operator-broadcast-render-test-types.js";

export interface BroadcastRenderTestClient {
  renderBroadcastDraft(
    input: BroadcastDraftRenderInput,
  ): Promise<BroadcastDraftRenderResult>;
  requestBroadcastTest(
    input: BroadcastTestRequestInput,
  ): Promise<BroadcastTestRequestResult>;
  readBroadcastTest(
    input: BroadcastTestReadInput,
  ): Promise<BroadcastTestResult>;
}

export function createBroadcastRenderTestClient(
  request: CoreRequester,
): BroadcastRenderTestClient {
  return {
    async renderBroadcastDraft(input) {
      const result = parseCoreReceipt(
        broadcastRender,
        await request(approvalPath(input.workspace, input.draftId), {
          lostResponseEffect: "none",
          body: {
            operation: "render_preview",
            expectedVersion: input.revision,
            postalAddress: null,
          },
        }),
      );
      if (result.draft_id !== input.draftId || result.revision !== input.revision) {
        invalidReceipt("none");
      }
      return result;
    },

    async requestBroadcastTest(input) {
      requireProofInput(input.renderProof, input.revision);
      const result = parseCoreReceipt(
        (value) => broadcastTestRequest(value, input.operationId),
        await request(approvalPath(input.workspace, input.draftId), {
          idempotencyKey: input.operationId,
          lostResponseEffect: "unknown",
          body: {
            operation: "send_test_to_verified_account",
            expectedVersion: input.revision,
            postalAddress: null,
            idempotencyKey: input.operationId,
            expectedRenderContentDigest: input.renderProof.render_hash,
          },
        }),
        "unknown",
      );
      if (
        result.draft_id !== input.draftId
        || result.revision !== input.revision
        || !sameProof(result.render_proof, input.renderProof)
      ) invalidReceipt("unknown");
      return result;
    },

    async readBroadcastTest(input) {
      const result = parseCoreReceipt(
        broadcastTestResult,
        await request(
          `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}`
            + `/test-deliveries/${segment(input.testId)}?environment=production`,
        ),
      );
      if (result.draft_id !== input.draftId || result.test_id !== input.testId) {
        invalidReceipt("none");
      }
      return result;
    },
  };
}

function approvalPath(workspace: string, draftId: string): string {
  return `${workspacePath(workspace)}/marketing-broadcasts/${segment(draftId)}`
    + "/send-approvals?environment=production";
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalidReceipt(coreEffect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, coreEffect);
}
