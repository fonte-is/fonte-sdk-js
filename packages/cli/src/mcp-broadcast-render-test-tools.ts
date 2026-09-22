import { HostedTestBlockedError } from "./hosted-errors.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import { CoreOperatorError } from "./operator-core-request.js";
import { renderBroadcastDraftInputSchema } from
  "./mcp-broadcast-render-types.js";
import {
  readBroadcastTestInputSchema,
  requestBroadcastTestInputSchema,
} from "./mcp-broadcast-test-types.js";
import type {
  BroadcastDraftRenderResult,
  BroadcastTestRequestResult,
  BroadcastTestResult,
} from "./operator-broadcast-render-test-types.js";
import type { BroadcastRenderTestClient } from
  "./operator-broadcast-render-test-client.js";

export const MCP_BROADCAST_RENDER_TOOL = "fonte_render_broadcast_draft" as const;
export const MCP_BROADCAST_TEST_REQUEST_TOOL =
  "fonte_request_broadcast_test" as const;
export const MCP_BROADCAST_TEST_READ_TOOL = "fonte_read_broadcast_test" as const;

export type BroadcastRenderTestClientProvider = () =>
  Promise<BroadcastRenderTestClient>;

interface ToolFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
}

export type BroadcastRenderToolResult = ToolFailure & { readonly render: null }
  | {
      readonly outcome: "completed";
      readonly reason: null;
      readonly status_code: null;
      readonly core_effect: "none";
      readonly render: BroadcastDraftRenderResult;
    };

export type BroadcastTestRequestToolResult = ToolFailure & {
  readonly test_request: null;
} | {
  readonly outcome: "completed";
  readonly reason: null;
  readonly status_code: null;
  readonly core_effect: "none";
  readonly test_request: BroadcastTestRequestResult;
};

export type BroadcastTestReadToolResult = ToolFailure & {
  readonly test_result: null;
} | {
  readonly outcome: "completed";
  readonly reason: null;
  readonly status_code: null;
  readonly core_effect: "none";
  readonly test_result: BroadcastTestResult;
};

export function createBroadcastRenderToolHandler(
  provider: BroadcastRenderTestClientProvider,
): (input: unknown) => Promise<BroadcastRenderToolResult> {
  return async (input) => {
    const value = renderBroadcastDraftInputSchema.parse(input);
    try {
      const client = await provider();
      return success("render", await client.renderBroadcastDraft({
        workspace: value.workspace,
        draftId: value.draft_id,
        revision: value.revision,
      }));
    } catch (error) {
      return { ...failure(error, false), render: null };
    }
  };
}

export function createBroadcastTestRequestToolHandler(
  provider: BroadcastRenderTestClientProvider,
): (input: unknown) => Promise<BroadcastTestRequestToolResult> {
  return async (input) => {
    const value = requestBroadcastTestInputSchema.parse(input);
    try {
      const client = await provider();
      return success("test_request", await client.requestBroadcastTest({
        workspace: value.workspace,
        draftId: value.draft_id,
        revision: value.revision,
        operationId: value.operation_id,
        renderProof: value.render_proof,
      }));
    } catch (error) {
      return { ...failure(error, true), test_request: null };
    }
  };
}

export function createBroadcastTestReadToolHandler(
  provider: BroadcastRenderTestClientProvider,
): (input: unknown) => Promise<BroadcastTestReadToolResult> {
  return async (input) => {
    const value = readBroadcastTestInputSchema.parse(input);
    try {
      const client = await provider();
      return success("test_result", await client.readBroadcastTest({
        workspace: value.workspace,
        draftId: value.draft_id,
        testId: value.test_id,
      }));
    } catch (error) {
      return { ...failure(error, false), test_result: null };
    }
  };
}

function success<Key extends string, Value>(key: Key, value: Value) {
  return {
    outcome: "completed" as const,
    reason: null,
    status_code: null,
    core_effect: "none" as const,
    [key]: value,
  } as { readonly outcome: "completed"; readonly reason: null;
    readonly status_code: null; readonly core_effect: "none" }
    & Record<Key, Value>;
}

function failure(error: unknown, mutation: boolean): ToolFailure {
  if (error instanceof HostedTestBlockedError) {
    return sequenceMcpFailure(error);
  }
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

function coreOutcome(error: CoreOperatorError): ToolFailure["outcome"] {
  if (error.coreEffect === "unknown") return "ambiguous";
  if (
    error.statusCode === 401 || error.statusCode === 403
    || error.statusCode === 404
  ) return "denied";
  if (error.statusCode !== null && error.statusCode >= 400
    && error.statusCode < 500) return "conflict";
  return "unavailable";
}

function safeReason(value: string): string {
  return /^[a-z0-9_]{1,100}$/.test(value) ? value : "unexpected_failure";
}
