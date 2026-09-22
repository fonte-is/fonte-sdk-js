import { HostedTestBlockedError } from "./hosted-errors.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import { CoreOperatorError } from "./operator-core-request.js";
import { reviseBroadcastDraftInputSchema } from
  "./mcp-broadcast-draft-revision-types.js";
import type {
  BroadcastDraftRevisionChanges,
  BroadcastDraftRevisionClient,
  BroadcastDraftRevisionResult,
} from "./operator-broadcast-draft-revision-client.js";

export const MCP_BROADCAST_DRAFT_REVISION_TOOL =
  "fonte_update_broadcast_draft" as const;

export type BroadcastDraftRevisionClientProvider = () =>
  Promise<BroadcastDraftRevisionClient>;

interface BroadcastDraftRevisionFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
  readonly revision: null;
}

interface BroadcastDraftRevisionSuccess {
  readonly outcome: "completed";
  readonly reason: null;
  readonly status_code: null;
  readonly core_effect: "none";
  readonly revision: BroadcastDraftRevisionResult;
}

export type BroadcastDraftRevisionToolResult =
  | BroadcastDraftRevisionSuccess
  | BroadcastDraftRevisionFailure;

export function createBroadcastDraftRevisionToolHandler(
  provider: BroadcastDraftRevisionClientProvider,
): (input: unknown) => Promise<BroadcastDraftRevisionToolResult> {
  return async (input) => {
    const value = reviseBroadcastDraftInputSchema.parse(input);
    try {
      const client = await provider();
      return {
        outcome: "completed",
        reason: null,
        status_code: null,
        core_effect: "none",
        revision: await client.reviseBroadcastDraft({
          workspace: value.workspace,
          draftId: value.draft_id,
          baseRevision: value.base_revision,
          operationId: value.operation_id,
          changes: clientChanges(value.changes),
        }),
      };
    } catch (error) {
      return failure(error);
    }
  };
}

function clientChanges(
  changes: {
    readonly title?: string | null;
    readonly subject?: string | null;
    readonly preheader?: string | null;
    readonly text_body?: string | null;
    readonly active_source?: "composer" | "html";
    readonly composer_body?: string | null;
    readonly html_body?: string | null;
  },
): BroadcastDraftRevisionChanges {
  return {
    ...(changes.title === undefined ? {} : { title: changes.title }),
    ...(changes.subject === undefined ? {} : { subject: changes.subject }),
    ...(changes.preheader === undefined
      ? {} : { preheader: changes.preheader }),
    ...(changes.text_body === undefined
      ? {} : { textBody: changes.text_body }),
    ...(changes.active_source === undefined
      ? {} : { activeSource: changes.active_source }),
    ...(changes.composer_body === undefined
      ? {} : { composerBody: changes.composer_body }),
    ...(changes.html_body === undefined
      ? {} : { htmlBody: changes.html_body }),
  };
}

function failure(error: unknown): BroadcastDraftRevisionFailure {
  if (error instanceof HostedTestBlockedError) {
    return { ...sequenceMcpFailure(error), revision: null };
  }
  if (!(error instanceof CoreOperatorError)) {
    return {
      outcome: "ambiguous",
      reason: "unexpected_failure",
      status_code: null,
      core_effect: "unknown",
      revision: null,
    };
  }
  return {
    outcome: coreOutcome(error),
    reason: safeReason(error.reason),
    status_code: error.statusCode,
    core_effect: error.coreEffect,
    revision: null,
  };
}

function coreOutcome(
  error: CoreOperatorError,
): BroadcastDraftRevisionFailure["outcome"] {
  if (
    error.coreEffect === "unknown" ||
    error.reason === "core_operator_receipt_invalid"
  ) {
    return "ambiguous";
  }
  if (
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.statusCode === 404
  ) {
    return "denied";
  }
  if (
    error.statusCode !== null &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return "conflict";
  }
  return "unavailable";
}

function safeReason(value: string): string {
  return /^[a-z0-9_]{1,100}$/.test(value)
    ? value
    : "unexpected_failure";
}
