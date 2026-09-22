import { HostedTestBlockedError } from "./hosted-errors.js";
import { updateBroadcastTargetingInputSchema } from "./mcp-broadcast-targeting-types.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import { CoreOperatorError } from "./operator-core-request.js";
import type {
  BroadcastTargetingClient,
  BroadcastTargetingResult,
} from "./operator-broadcast-targeting-client.js";

export const MCP_BROADCAST_TARGETING_UPDATE_TOOL =
  "fonte_update_broadcast_targeting" as const;

export type BroadcastTargetingClientProvider =
  () => Promise<BroadcastTargetingClient>;

interface TargetingFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
  readonly targeting: null;
}

interface TargetingSuccess {
  readonly outcome: "completed";
  readonly reason: null;
  readonly status_code: null;
  readonly core_effect: "none";
  readonly targeting: BroadcastTargetingResult;
}

export type BroadcastTargetingToolResult = TargetingFailure | TargetingSuccess;

export function createBroadcastTargetingToolHandler(
  provider: BroadcastTargetingClientProvider,
): (input: unknown) => Promise<BroadcastTargetingToolResult> {
  return async (input) => {
    const value = updateBroadcastTargetingInputSchema.parse(input);
    try {
      const client = await provider();
      return {
        outcome: "completed",
        reason: null,
        status_code: null,
        core_effect: "none",
        targeting: await client.updateBroadcastTargeting({
          workspace: value.workspace,
          draftId: value.draft_id,
          baseRevision: value.base_revision,
          operationId: value.operation_id,
          recipientSelection: value.recipient_selection,
        }),
      };
    } catch (error) {
      return failure(error);
    }
  };
}

function failure(error: unknown): TargetingFailure {
  if (error instanceof HostedTestBlockedError) {
    return { ...sequenceMcpFailure(error), targeting: null };
  }
  if (!(error instanceof CoreOperatorError)) {
    return {
      outcome: "ambiguous",
      reason: "unexpected_failure",
      status_code: null,
      core_effect: "unknown",
      targeting: null,
    };
  }
  return {
    outcome: coreOutcome(error),
    reason: safeReason(error.reason),
    status_code: error.statusCode,
    core_effect: error.coreEffect,
    targeting: null,
  };
}

function coreOutcome(error: CoreOperatorError): TargetingFailure["outcome"] {
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
  return /^[a-z0-9_]{1,100}$/.test(value) ? value : "unexpected_failure";
}
