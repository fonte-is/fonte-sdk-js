import type { McpServer } from "@modelcontextprotocol/server";

import {
  listBroadcastSendersInputSchema,
  listBroadcastSendersOutputSchema,
  updateBroadcastSenderInputSchema,
  updateBroadcastSenderOutputSchema,
} from "./mcp-broadcast-sender-types.js";
import {
  createListBroadcastSendersToolHandler,
  createUpdateBroadcastSenderToolHandler,
  MCP_BROADCAST_SENDER_LIST_TOOL,
  MCP_BROADCAST_SENDER_UPDATE_TOOL,
  type BroadcastSenderClientProvider,
} from "./mcp-broadcast-sender-tools.js";

export function registerMcpBroadcastSenderTools(
  server: McpServer,
  provider: BroadcastSenderClientProvider,
): void {
  const list = createListBroadcastSendersToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SENDER_LIST_TOOL,
    {
      title: "List verified Broadcast senders",
      description:
        "Lists Core-verified production sender profiles and exact-matches an optional name or address. One profile is selected automatically; ambiguous choices are returned and never guessed.",
      inputSchema: listBroadcastSendersInputSchema,
      outputSchema: listBroadcastSendersOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await list(input)),
  );

  const update = createUpdateBroadcastSenderToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_SENDER_UPDATE_TOOL,
    {
      title: "Update Broadcast sender",
      description:
        "Revision-checks one verified sender profile ID and optional explicit reply-to on the same unsent draft. It does not render, test, target, authorize, or send.",
      inputSchema: updateBroadcastSenderInputSchema,
      outputSchema: updateBroadcastSenderOutputSchema,
      annotations: revisionMutation,
    },
    async (input) => result(await update(input)),
  );
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const revisionMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
