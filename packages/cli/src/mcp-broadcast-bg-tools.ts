import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { BroadcastClientOptions } from "./broadcast-client.js";
import {
  runBroadcastCommand,
  type BroadcastCommand,
} from "./broadcast-command.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import {
  broadcastScopeSchema,
  broadcastReviewRequestSchema,
  broadcastUuid,
  savedBroadcastRequestSchema,
} from "./broadcast-validation.js";

export const MCP_BROADCAST_BG_TOOLS = {
  review: "fonte_prepare_broadcast",
  send: "fonte_send_broadcast",
  recover: "fonte_recover_broadcast_request",
  read: "fonte_read_broadcast_send_operation",
} as const;
const ceiling = z.number().int().min(1).max(2_147_483_647).default(60_000);
const wait = z.number().int().min(0).max(2_147_483_647).default(0);
const observation = { request_timeout_ms: ceiling, wait_ms: wait };
export const broadcastBgReviewToolInput = broadcastScopeSchema.extend({
  request: broadcastReviewRequestSchema,
  ...observation,
});
export const broadcastBgSendToolInput = z.strictObject({
  send_input: savedBroadcastRequestSchema,
  ...observation,
});
export const broadcastBgRecoverToolInput = broadcastScopeSchema.extend({
  request_id: broadcastUuid,
  ...observation,
});
export const broadcastBgReadToolInput = broadcastScopeSchema.extend({
  operation_uri: z.string().min(1).max(2048),
  kind: z.enum(["review", "send"]).default("send"),
  ...observation,
});
export interface BroadcastMcpDependencies extends BroadcastClientOptions {
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}
export type BroadcastMcpProvider = () => Promise<BroadcastMcpDependencies>;

export function createBroadcastBgToolHandlers(provider: BroadcastMcpProvider) {
  const execute = async (command: BroadcastCommand) => {
    try {
      return await runBroadcastCommand(command, await provider());
    } catch (error) {
      const requestId =
        command.kind === "broadcast_bg_send"
          ? command.input.request.requestId
          : command.kind === "broadcast_bg_review"
            ? command.input.requestId
            : command.kind === "broadcast_bg_recover"
              ? command.requestId
              : null;
      return {
        ...sequenceMcpFailure(error),
        request_id: requestId,
        operation: null,
      };
    }
  };
  const common = (value: { request_timeout_ms: number; wait_ms: number }) => ({
    json: true,
    requestTimeoutMs: value.request_timeout_ms,
    foregroundWaitMs: value.wait_ms,
  });
  return {
    async review(input: unknown) {
      const value = broadcastBgReviewToolInput.parse(input);
      const {
        request: body,
        request_timeout_ms: _timeout,
        wait_ms: _wait,
        ...scope
      } = value;
      return execute({
        kind: "broadcast_bg_review",
        scope,
        input: body,
        ...common(value),
      });
    },
    async send(input: unknown) {
      const value = broadcastBgSendToolInput.parse(input);
      return execute({
        kind: "broadcast_bg_send",
        input: value.send_input,
        ...common(value),
      });
    },
    async recover(input: unknown) {
      const value = broadcastBgRecoverToolInput.parse(input);
      const {
        request_id: requestId,
        request_timeout_ms: _timeout,
        wait_ms: _wait,
        ...scope
      } = value;
      return execute({
        kind: "broadcast_bg_recover",
        scope,
        requestId,
        ...common(value),
      });
    },
    async read(input: unknown) {
      const value = broadcastBgReadToolInput.parse(input);
      const {
        operation_uri: operationUri,
        kind: operationKind,
        request_timeout_ms: _timeout,
        wait_ms: _wait,
        ...scope
      } = value;
      return execute({
        kind: "broadcast_bg_read",
        scope,
        operationUri,
        operationKind,
        ...common(value),
      });
    },
  };
}
/** Root composes this once in the authenticated MCP session, replacing the existing normal
 * fonte_prepare_broadcast/send/read registrations. Never duplicate tool names or retired now. */
export function registerMcpBroadcastBgTools(
  server: McpServer,
  provider: BroadcastMcpProvider,
): void {
  const handlers = createBroadcastBgToolHandlers(provider);
  const mutation = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const readOnly = { ...mutation, readOnlyHint: true };
  const sendMutation = { ...mutation, destructiveHint: true };
  server.registerTool(
    MCP_BROADCAST_BG_TOOLS.review,
    {
      title: "Review Broadcast",
      inputSchema: broadcastBgReviewToolInput,
      description:
        "Asks Core to review one exact draft version; review never authorizes execution.",
      annotations: mutation,
    },
    async (input) => result(await handlers.review(input)),
  );
  server.registerTool(
    MCP_BROADCAST_BG_TOOLS.send,
    {
      title: "Send approved Broadcast",
      inputSchema: broadcastBgSendToolInput,
      description:
        "Durably saves and submits the exact approved review references. Processing is not executable.",
      annotations: sendMutation,
    },
    async (input) => result(await handlers.send(input)),
  );
  server.registerTool(
    MCP_BROADCAST_BG_TOOLS.recover,
    {
      title: "Recover saved Broadcast request",
      inputSchema: broadcastBgRecoverToolInput,
      description:
        "Replays the same saved input and request key after response loss; never creates a new approval.",
      annotations: sendMutation,
    },
    async (input) => result(await handlers.recover(input)),
  );
  server.registerTool(
    MCP_BROADCAST_BG_TOOLS.read,
    {
      title: "Observe Broadcast operation",
      inputSchema: broadcastBgReadToolInput,
      description:
        "Reads Core's returned same-origin operation URI without Send or commercial mutation.",
      annotations: readOnly,
    },
    async (input) => result(await handlers.read(input)),
  );
}
function result(value: Awaited<ReturnType<typeof runBroadcastCommand>>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(value.operation === null ? { isError: true } : {}),
  };
}
