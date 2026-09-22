import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  cancelBroadcastSendInputSchema,
  increaseBroadcastSpendLimitInputSchema,
  readBroadcastSendOperationInputSchema,
  replaceBroadcastScheduleInputSchema,
  scheduleBroadcastInputSchema,
  sendBroadcastNowInputSchema,
} from "./mcp-broadcast-send-instruction-types.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import type { BroadcastSendInstructionClient } from "./operator-broadcast-send-instruction-client.js";
import { CoreOperatorError } from "./operator-core-request.js";
import type { BroadcastSendOperationResult } from "./operator-broadcast-send-instruction-types.js";

export const MCP_BROADCAST_SEND_NOW_TOOL = "fonte_send_broadcast_now" as const;
export const MCP_BROADCAST_SCHEDULE_TOOL = "fonte_schedule_broadcast" as const;
export const MCP_BROADCAST_SEND_READ_TOOL =
  "fonte_read_broadcast_send_operation" as const;
export const MCP_BROADCAST_SCHEDULE_REPLACE_TOOL =
  "fonte_replace_broadcast_schedule" as const;
export const MCP_BROADCAST_SEND_CANCEL_TOOL =
  "fonte_cancel_broadcast_send" as const;
export const MCP_BROADCAST_SPEND_LIMIT_INCREASE_TOOL =
  "fonte_increase_broadcast_spend_limit" as const;

export type BroadcastSendInstructionClientProvider =
  () => Promise<BroadcastSendInstructionClient>;

interface ToolFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
  readonly operation: null;
}

interface ToolSuccess {
  readonly outcome: "completed";
  readonly reason: null;
  readonly status_code: null;
  readonly core_effect: "none";
  readonly operation: BroadcastSendOperationResult;
}

export type BroadcastSendInstructionToolResult = ToolFailure | ToolSuccess;

export function createBroadcastSendNowToolHandler(
  provider: BroadcastSendInstructionClientProvider,
) {
  return async (
    input: unknown,
  ): Promise<BroadcastSendInstructionToolResult> => {
    const value = sendBroadcastNowInputSchema.parse(input);
    return invoke(
      true,
      async (client) =>
        client.acceptBroadcastSend({
          workspace: value.workspace,
          draftId: value.draft_id,
          requestId: value.request_id,
          expectedDraftVersion: value.expected_draft_version,
          timing: { mode: "now" },
        }),
      provider,
    );
  };
}

export function createBroadcastScheduleToolHandler(
  provider: BroadcastSendInstructionClientProvider,
) {
  return async (
    input: unknown,
  ): Promise<BroadcastSendInstructionToolResult> => {
    const value = scheduleBroadcastInputSchema.parse(input);
    return invoke(
      true,
      async (client) =>
        client.acceptBroadcastSend({
          workspace: value.workspace,
          draftId: value.draft_id,
          requestId: value.request_id,
          expectedDraftVersion: value.expected_draft_version,
          timing: { mode: "scheduled", notBefore: value.not_before },
        }),
      provider,
    );
  };
}

export function createBroadcastSendReadToolHandler(
  provider: BroadcastSendInstructionClientProvider,
) {
  return async (
    input: unknown,
  ): Promise<BroadcastSendInstructionToolResult> => {
    const value = readBroadcastSendOperationInputSchema.parse(input);
    return invoke(
      false,
      async (client) =>
        client.readBroadcastSendOperation({
          workspace: value.workspace,
          draftId: value.draft_id,
        }),
      provider,
    );
  };
}

export function createBroadcastScheduleReplaceToolHandler(
  provider: BroadcastSendInstructionClientProvider,
) {
  return async (
    input: unknown,
  ): Promise<BroadcastSendInstructionToolResult> => {
    const value = replaceBroadcastScheduleInputSchema.parse(input);
    return invoke(
      true,
      async (client) =>
        client.replaceBroadcastSendSchedule({
          workspace: value.workspace,
          draftId: value.draft_id,
          requestId: value.request_id,
          expectedInstructionGeneration: value.expected_instruction_generation,
          expectedDraftVersion: value.expected_draft_version,
          notBefore: value.not_before,
        }),
      provider,
    );
  };
}

export function createBroadcastSendCancelToolHandler(
  provider: BroadcastSendInstructionClientProvider,
) {
  return async (
    input: unknown,
  ): Promise<BroadcastSendInstructionToolResult> => {
    const value = cancelBroadcastSendInputSchema.parse(input);
    return invoke(
      true,
      async (client) =>
        client.cancelBroadcastSend({
          workspace: value.workspace,
          draftId: value.draft_id,
          requestId: value.request_id,
          expectedInstructionGeneration: value.expected_instruction_generation,
        }),
      provider,
    );
  };
}

export function createBroadcastSpendLimitIncreaseToolHandler(
  provider: BroadcastSendInstructionClientProvider,
) {
  return async (
    input: unknown,
  ): Promise<BroadcastSendInstructionToolResult> => {
    const value = increaseBroadcastSpendLimitInputSchema.parse(input);
    return invoke(
      true,
      async (client) =>
        client.resolveBroadcastSpendLimit({
          workspace: value.workspace,
          draftId: value.draft_id,
          requestId: value.request_id,
          expectedInstructionGeneration: value.expected_instruction_generation,
          expectedApprovalGeneration: value.expected_approval_generation,
        }),
      provider,
    );
  };
}

async function invoke(
  mutation: boolean,
  effect: (
    client: BroadcastSendInstructionClient,
  ) => Promise<BroadcastSendOperationResult>,
  provider: BroadcastSendInstructionClientProvider,
): Promise<BroadcastSendInstructionToolResult> {
  try {
    return {
      outcome: "completed",
      reason: null,
      status_code: null,
      core_effect: "none",
      operation: await effect(await provider()),
    };
  } catch (error) {
    if (error instanceof HostedTestBlockedError) {
      return { ...sequenceMcpFailure(error), operation: null };
    }
    if (!(error instanceof CoreOperatorError)) {
      return {
        outcome: mutation ? "ambiguous" : "unavailable",
        reason: "unexpected_failure",
        status_code: null,
        core_effect: mutation ? "unknown" : "none",
        operation: null,
      };
    }
    return {
      outcome: coreOutcome(error),
      reason: safeReason(error.reason),
      status_code: error.statusCode,
      core_effect: error.coreEffect,
      operation: null,
    };
  }
}

function coreOutcome(error: CoreOperatorError): ToolFailure["outcome"] {
  if (error.coreEffect === "unknown") return "ambiguous";
  if ([401, 403, 404].includes(error.statusCode ?? 0)) return "denied";
  if (
    error.statusCode !== null &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  )
    return "conflict";
  return "unavailable";
}

function safeReason(value: string): string {
  return /^[a-z0-9_]{1,100}$/u.test(value) ? value : "unexpected_failure";
}
