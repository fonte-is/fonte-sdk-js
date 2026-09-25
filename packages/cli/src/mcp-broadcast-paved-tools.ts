import {
  type BroadcastPavedOperator,
  type BroadcastPavedPreparationResult,
  type BroadcastPavedRequest,
} from "./operator-broadcast-paved.js";
import {
  prepareBroadcastPavedInputSchema,
  sendPreparedBroadcastInputSchema,
} from "./mcp-broadcast-paved-types.js";

export const MCP_BROADCAST_PREPARE_PAVED_TOOL = "fonte_prepare_broadcast" as const;
export const MCP_BROADCAST_SEND_PAVED_TOOL = "fonte_send_broadcast" as const;

export function createBroadcastPreparePavedToolHandler(
  operator: BroadcastPavedOperator,
): (input: unknown) => Promise<BroadcastPavedPreparationResult> {
  return async (input) => {
    const parsed = prepareBroadcastPavedInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "blocked",
        draft_id: null,
        revision: null,
        summary: "Preparation input is invalid; no draft or Send action was attempted.",
        missing: [],
        choices: [],
        warnings: [
          ...new Set(
            parsed.error.issues.map((issue) =>
              issue.path.length > 0
                ? `invalid_${issue.path.join("_").replace(/[^a-zA-Z0-9_]/gu, "_").toLowerCase()}`
                : "invalid_request",
            ),
          ),
        ],
        send_input: null,
      };
    }
    return operator.prepare(parsed.data as BroadcastPavedRequest);
  };
}

export function createBroadcastSendPavedToolHandler(
  operator: BroadcastPavedOperator,
) {
  return async (input: unknown) => {
    const parsed = sendPreparedBroadcastInputSchema.safeParse(input);
    if (!parsed.success) {
      return blockedReceipt("invalid_durable_send_input", null, "missing");
    }
    return operator.send(parsed.data);
  };
}

export function createBroadcastPavedToolHandlers(
  operator: BroadcastPavedOperator,
) {
  return {
    prepare: createBroadcastPreparePavedToolHandler(operator),
    send: createBroadcastSendPavedToolHandler(operator),
  };
}

export function blockedReceipt(
  reason: string,
  workspace: string | null,
  authorityStatus: "current" | "missing",
) {
  return {
    schema_version: "fonte.cli.operator_receipt.v1" as const,
    command: "broadcast_send_now" as const,
    outcome: "blocked" as const,
    reason: /^[a-z0-9_]{1,100}$/u.test(reason)
      ? reason
      : "broadcast_send_blocked",
    workspace,
    authority: authorityStatus === "current"
      ? {
        status: "current" as const,
        contract_id: "fonte.core.broadcast_send" as const,
      }
      : { status: "missing" as const, contract_id: "unavailable" as const },
    core_effect: "none" as const,
    result: null,
  };
}
