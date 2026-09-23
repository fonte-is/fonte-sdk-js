import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { broadcastSendOperationEnvelope } from "./operator-broadcast-send-instruction-json.js";
import type {
  AcceptBroadcastSendInput,
  AmendBroadcastSendApprovalInput,
  BroadcastSendOperationResult,
  CancelBroadcastSendInput,
  ReadBroadcastSendOperationInput,
  ReplaceBroadcastSendScheduleInput,
  ResolveBroadcastSpendLimitInput,
} from "./operator-broadcast-send-instruction-types.js";

const CANONICAL_PUBLIC_SEND_RAIL = "canonical_execution_cell_v1";

export interface BroadcastSendInstructionClient {
  acceptBroadcastSend(
    input: AcceptBroadcastSendInput,
  ): Promise<BroadcastSendOperationResult>;
  readBroadcastSendOperation(
    input: ReadBroadcastSendOperationInput,
  ): Promise<BroadcastSendOperationResult>;
  replaceBroadcastSendSchedule(
    input: ReplaceBroadcastSendScheduleInput,
  ): Promise<BroadcastSendOperationResult>;
  cancelBroadcastSend(
    input: CancelBroadcastSendInput,
  ): Promise<BroadcastSendOperationResult>;
  amendBroadcastSendApproval(
    input: AmendBroadcastSendApprovalInput,
  ): Promise<BroadcastSendOperationResult>;
  resolveBroadcastSpendLimit(
    input: ResolveBroadcastSpendLimitInput,
  ): Promise<BroadcastSendOperationResult>;
}

export function createBroadcastSendInstructionClient(
  request: CoreRequester,
): BroadcastSendInstructionClient {
  const mutation = async (
    input: {
      readonly workspace: string;
      readonly draftId: string;
      readonly requestId: string;
    },
    action: "" | "/revisions" | "/approval" | "/cancel",
    body: Record<string, unknown>,
  ) => {
    const result = matching(
      input,
      parseCoreReceipt(
        broadcastSendOperationEnvelope,
        await request(
          `${sendIntentPath(input)}${action}?environment=production`,
          {
            idempotencyKey: input.requestId,
            lostResponseEffect: "unknown",
            body,
          },
        ),
        "unknown",
      ),
      "unknown",
    );
    if (result.status !== "accepted") invalid("unknown");
    return result;
  };

  const client: BroadcastSendInstructionClient = {
    async acceptBroadcastSend(input) {
      return mutation(input, "", {
        schema: "broadcast_send_intent.v3",
        requestId: input.requestId,
        executionRail: CANONICAL_PUBLIC_SEND_RAIL,
        expectedDraftVersion: input.expectedDraftVersion,
        timing: input.timing,
      });
    },
    async readBroadcastSendOperation(input) {
      return matching(
        input,
        parseCoreReceipt(
          broadcastSendOperationEnvelope,
          await request(`${sendIntentPath(input)}?environment=production`),
        ),
        "none",
      );
    },
    async replaceBroadcastSendSchedule(input) {
      return mutation(input, "/revisions", {
        schema: "broadcast_send_instruction_replacement.v1",
        requestId: input.requestId,
        expectedInstructionGeneration: input.expectedInstructionGeneration,
        expectedDraftVersion: input.expectedDraftVersion,
        timing: { mode: "scheduled", notBefore: input.notBefore },
      });
    },
    async cancelBroadcastSend(input) {
      return mutation(input, "/cancel", {
        schema: "broadcast_send_cancel.v1",
        requestId: input.requestId,
        expectedInstructionGeneration: input.expectedInstructionGeneration,
      });
    },
    async amendBroadcastSendApproval(input) {
      return mutation(input, "/approval", {
        schema: "broadcast_send_approval_amendment.v1",
        requestId: input.requestId,
        expectedInstructionGeneration: input.expectedInstructionGeneration,
        expectedApprovalGeneration: input.expectedApprovalGeneration,
      });
    },
    async resolveBroadcastSpendLimit(input) {
      const current = await client.readBroadcastSendOperation(input);
      if (current.status !== "accepted")
        conflict("broadcast_send_operation_absent");
      const action = current.operation.required_action;
      if (
        action?.kind !== "increase_account_spend_limit" ||
        !current.operation.allowed_actions.includes("increase_spend_limit") ||
        current.operation.instruction_generation !==
          input.expectedInstructionGeneration ||
        current.operation.approval_generation !==
          input.expectedApprovalGeneration
      ) {
        conflict("broadcast_spend_limit_action_changed");
      }
      const billing = await request(
        `${workspacePath(input.workspace)}/billing/payment-method?environment=production`,
        {
          lostResponseEffect: "unknown",
          body: {
            operation: "spending_cap_update",
            spendingCapMinor: action.minimum_maximum_minor,
          },
        },
      );
      verifySpendingLimit(billing, action.minimum_maximum_minor);
      return client.amendBroadcastSendApproval(input);
    },
  };
  return client;
}

function matching(
  input: { readonly workspace: string; readonly draftId: string },
  result: BroadcastSendOperationResult,
  effect: "none" | "unknown",
): BroadcastSendOperationResult {
  if (
    result.status === "accepted" &&
    (result.operation.draft_id !== input.draftId ||
      result.operation.environment !== "production")
  )
    invalid(effect);
  return result;
}

function verifySpendingLimit(value: unknown, expected: number): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("unknown");
  const balance = (value as Record<string, unknown>).emailBalance;
  if (
    !balance ||
    typeof balance !== "object" ||
    Array.isArray(balance) ||
    (balance as Record<string, unknown>).spendingCapMinor !== expected
  )
    invalid("unknown");
}

function sendIntentPath(input: {
  readonly workspace: string;
  readonly draftId: string;
}): string {
  return `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}/send-intent`;
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function conflict(reason: string): never {
  throw new CoreOperatorError(reason, 409, "none");
}

function invalid(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
