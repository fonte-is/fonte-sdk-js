import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  createBroadcastDraftInputSchema,
  readBroadcastDraftInputSchema,
} from "./mcp-broadcast-draft-lifecycle-types.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import { CoreOperatorError } from "./operator-core-request.js";
import type {
  BroadcastDraftLifecycleClient,
  BroadcastDraftLifecycleResult,
} from "./operator-broadcast-draft-lifecycle-client.js";

export const MCP_BROADCAST_DRAFT_CREATE_TOOL =
  "fonte_create_broadcast_draft" as const;
export const MCP_BROADCAST_DRAFT_READ_TOOL =
  "fonte_read_broadcast_draft" as const;

export type BroadcastDraftLifecycleClientProvider = () =>
  Promise<BroadcastDraftLifecycleClient>;

interface ToolFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
  readonly draft: null;
}

interface ToolSuccess {
  readonly outcome: "completed";
  readonly reason: null;
  readonly status_code: null;
  readonly core_effect: "none";
  readonly draft: BroadcastDraftLifecycleResult;
}

export type BroadcastDraftLifecycleToolResult = ToolFailure | ToolSuccess;

export function createBroadcastDraftCreateToolHandler(
  provider: BroadcastDraftLifecycleClientProvider,
): (input: unknown) => Promise<BroadcastDraftLifecycleToolResult> {
  return async (input) => {
    const value = createBroadcastDraftInputSchema.parse(input);
    try {
      const client = await provider();
      return success(await client.createBroadcastDraft({
        workspace: value.workspace,
        draftId: value.draft_id,
        title: value.title,
        subject: value.subject,
        preheader: value.preheader,
        activeSource: value.active_source,
        composerBody: value.composer_body,
        htmlBody: value.html_body,
      }));
    } catch (error) {
      return failure(error, true);
    }
  };
}

export function createBroadcastDraftReadToolHandler(
  provider: BroadcastDraftLifecycleClientProvider,
): (input: unknown) => Promise<BroadcastDraftLifecycleToolResult> {
  return async (input) => {
    const value = readBroadcastDraftInputSchema.parse(input);
    try {
      const client = await provider();
      return success(await client.readBroadcastDraft({
        workspace: value.workspace,
        draftId: value.draft_id,
      }));
    } catch (error) {
      return failure(error, false);
    }
  };
}

function success(draft: BroadcastDraftLifecycleResult): ToolSuccess {
  return {
    outcome: "completed",
    reason: null,
    status_code: null,
    core_effect: "none",
    draft,
  };
}

function failure(error: unknown, mutation: boolean): ToolFailure {
  if (error instanceof HostedTestBlockedError) {
    return { ...sequenceMcpFailure(error), draft: null };
  }
  if (!(error instanceof CoreOperatorError)) {
    return {
      outcome: mutation ? "ambiguous" : "unavailable",
      reason: "unexpected_failure",
      status_code: null,
      core_effect: mutation ? "unknown" : "none",
      draft: null,
    };
  }
  return {
    outcome: coreOutcome(error),
    reason: safeReason(error.reason),
    status_code: error.statusCode,
    core_effect: error.coreEffect,
    draft: null,
  };
}

function coreOutcome(error: CoreOperatorError): ToolFailure["outcome"] {
  if (error.coreEffect === "unknown") return "ambiguous";
  if (error.statusCode === 401 || error.statusCode === 403
    || error.statusCode === 404) return "denied";
  if (error.statusCode !== null && error.statusCode >= 400
    && error.statusCode < 500) return "conflict";
  return "unavailable";
}

function safeReason(value: string): string {
  return /^[a-z0-9_]{1,100}$/.test(value) ? value : "unexpected_failure";
}
