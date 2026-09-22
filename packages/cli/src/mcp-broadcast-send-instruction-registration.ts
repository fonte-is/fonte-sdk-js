import type { McpServer } from "@modelcontextprotocol/server";

import {
  broadcastSendInstructionOutputSchema,
  cancelBroadcastSendInputSchema,
  increaseBroadcastSpendLimitInputSchema,
  readBroadcastSendOperationInputSchema,
  replaceBroadcastScheduleInputSchema,
  scheduleBroadcastInputSchema,
  sendBroadcastNowInputSchema,
} from "./mcp-broadcast-send-instruction-types.js";
import {
  createBroadcastScheduleReplaceToolHandler,
  createBroadcastScheduleToolHandler,
  createBroadcastSendCancelToolHandler,
  createBroadcastSendNowToolHandler,
  createBroadcastSendReadToolHandler,
  createBroadcastSpendLimitIncreaseToolHandler,
  MCP_BROADCAST_SCHEDULE_REPLACE_TOOL,
  MCP_BROADCAST_SCHEDULE_TOOL,
  MCP_BROADCAST_SEND_CANCEL_TOOL,
  MCP_BROADCAST_SEND_NOW_TOOL,
  MCP_BROADCAST_SEND_READ_TOOL,
  MCP_BROADCAST_SPEND_LIMIT_INCREASE_TOOL,
  type BroadcastSendInstructionClientProvider,
} from "./mcp-broadcast-send-instruction-tools.js";

const observe = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const effect = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpBroadcastSendInstructionTools(
  server: McpServer,
  provider: BroadcastSendInstructionClientProvider,
): void {
  const sendNow = createBroadcastSendNowToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SEND_NOW_TOOL,
    {
      title: "Send Broadcast now",
      description:
        "After one explicit customer Send-now direction, accepts the exact saved draft as one durable v3 operation. No review, recipient preparation, count, quote, payment, or provider work is performed by this tool.",
      inputSchema: sendBroadcastNowInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: effect,
    },
    async (input) => result(await sendNow(input)),
  );

  const schedule = createBroadcastScheduleToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SCHEDULE_TOOL,
    {
      title: "Schedule Broadcast",
      description:
        "After one explicit customer Schedule direction, accepts the exact saved draft and future time as one durable v3 operation.",
      inputSchema: scheduleBroadcastInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: effect,
    },
    async (input) => result(await schedule(input)),
  );

  const read = createBroadcastSendReadToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SEND_READ_TOOL,
    {
      title: "Read Broadcast Send operation",
      description:
        "Observes one durable v3 Send operation with GET only. It never prepares, authorizes, retries, or advances work. Describe authorizing, packaging, and activation-pending phases as Preparing unless diagnostics were requested.",
      inputSchema: readBroadcastSendOperationInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: observe,
    },
    async (input) => result(await read(input)),
  );

  const replace = createBroadcastScheduleReplaceToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SCHEDULE_REPLACE_TOOL,
    {
      title: "Replace Broadcast schedule",
      description:
        "Generation-checks and atomically replaces an unclaimed scheduled instruction from the exact current saved draft.",
      inputSchema: replaceBroadcastScheduleInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: effect,
    },
    async (input) => result(await replace(input)),
  );

  const cancel = createBroadcastSendCancelToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SEND_CANCEL_TOOL,
    {
      title: "Cancel Broadcast Send",
      description:
        "Requests generation-fenced v3 cancellation through Core. It never calls a queue or provider directly.",
      inputSchema: cancelBroadcastSendInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: effect,
    },
    async (input) => result(await cancel(input)),
  );

  const increase = createBroadcastSpendLimitIncreaseToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SPEND_LIMIT_INCREASE_TOOL,
    {
      title: "Increase Broadcast account limit",
      description:
        "Use only after explicit customer authority. Reads Core's exact structured required action, applies that recurring account limit through the sanctioned billing mutation, then amends approval for the same operation. Performs no client cost math.",
      inputSchema: increaseBroadcastSpendLimitInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: effect,
    },
    async (input) => result(await increase(input)),
  );
}

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
