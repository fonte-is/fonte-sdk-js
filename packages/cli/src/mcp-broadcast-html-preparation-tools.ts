import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  prepareBroadcastHtmlInputSchema,
  reviseBroadcastHtmlInputSchema,
} from "./mcp-broadcast-html-preparation-types.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import {
  BroadcastHtmlPreparationContractError,
  BroadcastHtmlPreparationStageError,
  type BroadcastHtmlPreparationClient,
  type BroadcastHtmlPreparationResult,
  type BroadcastHtmlPreparationSuccess,
} from "./operator-broadcast-html-preparation.js";
import { BroadcastLocalFileError } from "./operator-broadcast-html-file.js";
import { BroadcastHtmlSourceError } from "./operator-broadcast-html-source.js";
import { CoreOperatorError } from "./operator-core-request.js";

export const MCP_BROADCAST_HTML_PREPARE_TOOL =
  "fonte_prepare_broadcast_html_file" as const;
export const MCP_BROADCAST_HTML_REVISE_TOOL =
  "fonte_revise_broadcast_html_file" as const;

export type BroadcastHtmlPreparationClientProvider =
  () => Promise<BroadcastHtmlPreparationClient>;

interface ToolResult {
  readonly outcome:
    | "completed"
    | "blocked"
    | "unavailable"
    | "denied"
    | "conflict"
    | "ambiguous";
  readonly reason: string | null;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
  readonly stage: "intake" | "save" | "readback" | "render" | "complete";
  readonly action: "create" | "revise";
  readonly source: BroadcastHtmlPreparationSuccess["source"] | null;
  readonly save: BroadcastHtmlPreparationSuccess["save"] | null;
  readonly readback: BroadcastHtmlPreparationSuccess["readback"] | null;
  readonly render: BroadcastHtmlPreparationSuccess["render"] | null;
}

export function createBroadcastHtmlPrepareToolHandler(
  provider: BroadcastHtmlPreparationClientProvider,
): (input: unknown) => Promise<ToolResult> {
  return async (input) => {
    const value = prepareBroadcastHtmlInputSchema.parse(input);
    try {
      return result(
        await (
          await provider()
        ).prepareBroadcastHtml({
          workspace: value.workspace,
          draftId: value.draft_id,
          title: value.title,
          subject: value.subject,
          preheader: value.preheader,
          ...sourceInput(value),
        }),
      );
    } catch (error) {
      return failure("create", error);
    }
  };
}

export function createBroadcastHtmlReviseToolHandler(
  provider: BroadcastHtmlPreparationClientProvider,
): (input: unknown) => Promise<ToolResult> {
  return async (input) => {
    const value = reviseBroadcastHtmlInputSchema.parse(input);
    try {
      return result(
        await (
          await provider()
        ).reviseBroadcastHtml({
          workspace: value.workspace,
          draftId: value.draft_id,
          baseRevision: value.base_revision,
          operationId: value.operation_id,
          ...sourceInput(value),
        }),
      );
    } catch (error) {
      return failure("revise", error);
    }
  };
}

function sourceInput(value: {
  readonly source_file: string;
  readonly reference_file: string | null;
  readonly postal_address_literal: string | null;
  readonly literal_fallbacks: Readonly<Record<string, string>>;
}) {
  return {
    sourceFile: value.source_file,
    referenceFile: value.reference_file,
    postalAddressLiteral: value.postal_address_literal,
    literalFallbacks: value.literal_fallbacks,
  };
}

function result(value: BroadcastHtmlPreparationResult): ToolResult {
  if (value.kind === "broadcast_html_preparation_blocked") {
    return {
      outcome: "blocked",
      reason: value.source.blockers[0] ?? "broadcast_source_blocked",
      status_code: null,
      core_effect: "none",
      stage: "intake",
      action: value.action,
      source: value.source,
      save: null,
      readback: null,
      render: null,
    };
  }
  return {
    outcome: "completed",
    reason: null,
    status_code: null,
    core_effect: "none",
    stage: "complete",
    action: value.action,
    source: value.source,
    save: value.save,
    readback: value.readback,
    render: value.render,
  };
}

function failure(action: ToolResult["action"], error: unknown): ToolResult {
  if (error instanceof BroadcastHtmlPreparationStageError) {
    const mapped = causeFailure(error.cause);
    return {
      ...mapped,
      stage: error.stage,
      action,
      source: error.source,
      save: error.save,
      readback: error.readback,
      render: null,
    };
  }
  if (
    error instanceof BroadcastLocalFileError ||
    error instanceof BroadcastHtmlSourceError
  ) {
    return emptyFailure(action, "blocked", error.reason);
  }
  return emptyFailure(action, "unavailable", "unexpected_failure");
}

function causeFailure(
  error: unknown,
): Pick<ToolResult, "outcome" | "reason" | "status_code" | "core_effect"> {
  if (error instanceof BroadcastHtmlPreparationContractError) {
    return {
      outcome: "unavailable",
      reason: error.reason,
      status_code: null,
      core_effect: "none",
    };
  }
  if (
    error instanceof CoreOperatorError ||
    error instanceof HostedTestBlockedError
  ) {
    return sequenceMcpFailure(error);
  }
  return {
    outcome: "ambiguous",
    reason: "unexpected_failure",
    status_code: null,
    core_effect: "unknown",
  };
}

function emptyFailure(
  action: ToolResult["action"],
  outcome: "blocked" | "unavailable",
  reason: string,
): ToolResult {
  return {
    outcome,
    reason,
    status_code: null,
    core_effect: "none",
    stage: "intake",
    action,
    source: null,
    save: null,
    readback: null,
    render: null,
  };
}
