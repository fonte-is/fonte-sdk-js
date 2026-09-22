import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  listBroadcastSendersInputSchema,
  updateBroadcastSenderInputSchema,
} from "./mcp-broadcast-sender-types.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import { CoreOperatorError } from "./operator-core-request.js";
import type {
  BroadcastSenderCatalog,
  BroadcastSenderClient,
} from "./operator-broadcast-sender-client.js";
import type { BroadcastDraftRevisionResult } from "./operator-broadcast-draft-revision-client.js";

export const MCP_BROADCAST_SENDER_LIST_TOOL =
  "fonte_list_broadcast_senders" as const;
export const MCP_BROADCAST_SENDER_UPDATE_TOOL =
  "fonte_update_broadcast_sender" as const;

export type BroadcastSenderClientProvider =
  () => Promise<BroadcastSenderClient>;

interface SenderFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
}

export function createListBroadcastSendersToolHandler(
  provider: BroadcastSenderClientProvider,
): (input: unknown) => Promise<
  | (SenderFailure & { readonly catalog: null })
  | {
      readonly outcome: "completed";
      readonly reason: null;
      readonly status_code: null;
      readonly core_effect: "none";
      readonly catalog: BroadcastSenderCatalog;
    }
> {
  return async (input) => {
    const value = listBroadcastSendersInputSchema.parse(input);
    try {
      const client = await provider();
      return {
        outcome: "completed",
        reason: null,
        status_code: null,
        core_effect: "none",
        catalog: await client.listBroadcastSenders({
          workspace: value.workspace,
          match: value.match ?? null,
        }),
      };
    } catch (error) {
      return { ...failure(error, false), catalog: null };
    }
  };
}

export function createUpdateBroadcastSenderToolHandler(
  provider: BroadcastSenderClientProvider,
): (input: unknown) => Promise<
  | (SenderFailure & { readonly revision: null })
  | {
      readonly outcome: "completed";
      readonly reason: null;
      readonly status_code: null;
      readonly core_effect: "none";
      readonly revision: BroadcastDraftRevisionResult;
    }
> {
  return async (input) => {
    const value = updateBroadcastSenderInputSchema.parse(input);
    try {
      const client = await provider();
      return {
        outcome: "completed",
        reason: null,
        status_code: null,
        core_effect: "none",
        revision: await client.updateBroadcastSender({
          workspace: value.workspace,
          draftId: value.draft_id,
          baseRevision: value.base_revision,
          operationId: value.operation_id,
          senderProfileId: value.sender_profile_id,
          ...(value.reply_to === undefined ? {} : { replyTo: value.reply_to }),
        }),
      };
    } catch (error) {
      return { ...failure(error, true), revision: null };
    }
  };
}

function failure(error: unknown, mutation: boolean): SenderFailure {
  if (error instanceof HostedTestBlockedError) return sequenceMcpFailure(error);
  if (!(error instanceof CoreOperatorError)) {
    return {
      outcome: mutation ? "ambiguous" : "unavailable",
      reason: "unexpected_failure",
      status_code: null,
      core_effect: mutation ? "unknown" : "none",
    };
  }
  return {
    outcome: coreOutcome(error),
    reason: safeReason(error.reason),
    status_code: error.statusCode,
    core_effect: error.coreEffect,
  };
}

function coreOutcome(error: CoreOperatorError): SenderFailure["outcome"] {
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
