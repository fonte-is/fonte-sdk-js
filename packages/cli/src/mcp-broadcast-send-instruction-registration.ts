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

export const MCP_BROADCAST_LEGACY_SEND_READ_TOOL =
  "fonte_read_legacy_broadcast_send_operation";

export function registerMcpBroadcastSendInstructionTools(
  server: McpServer,
  provider: BroadcastSendInstructionClientProvider,
  options: {
    readonly includeSendRead?: boolean;
    readonly readToolName?: string;
  } = {},
): void {
  const sendNow = createBroadcastSendNowToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SEND_NOW_TOOL,
    {
      title: "Send Broadcast now",
      description:
        "Retired unreviewed Send entrypoint. Use fonte_prepare_broadcast and fonte_send_broadcast with the exact reviewed send_input.",
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
        "Retired unreviewed Schedule entrypoint. Use the reviewed canonical Send path.",
      inputSchema: scheduleBroadcastInputSchema,
      outputSchema: broadcastSendInstructionOutputSchema,
      annotations: effect,
    },
    async (input) => result(await schedule(input)),
  );

  if (options.includeSendRead !== false) {
    const read = createBroadcastSendReadToolHandler(provider);
    server.registerTool(
      options.readToolName ?? MCP_BROADCAST_SEND_READ_TOOL,
      {
        title: options.readToolName
          ? "Read historical Broadcast Send operation"
          : "Read Broadcast Send operation",
        description:
          "Observes one durable v3 Send operation with GET only. It never prepares, authorizes, retries, or advances work. Describe authorizing, packaging, and activation-pending phases as Preparing unless diagnostics were requested.",
        inputSchema: readBroadcastSendOperationInputSchema,
        outputSchema: broadcastSendInstructionOutputSchema,
        annotations: observe,
      },
      async (input) => result(await read(input)),
    );
  }

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
