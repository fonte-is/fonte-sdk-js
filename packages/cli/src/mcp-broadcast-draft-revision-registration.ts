import type { McpServer } from "@modelcontextprotocol/server";

import {
  createBroadcastDraftRevisionToolHandler,
  MCP_BROADCAST_DRAFT_REVISION_TOOL,
  type BroadcastDraftRevisionClientProvider,
} from "./mcp-broadcast-draft-revision-tools.js";
import {
  reviseBroadcastDraftInputSchema,
  reviseBroadcastDraftOutputSchema,
} from "./mcp-broadcast-draft-revision-types.js";

const draftMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpBroadcastDraftRevisionTool(
  server: McpServer,
  provider: BroadcastDraftRevisionClientProvider,
): void {
  const handler = createBroadcastDraftRevisionToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_DRAFT_REVISION_TOOL,
    {
      title: "Update Broadcast draft copy",
      description:
        "Revision-checks title, subject, or preheader on one existing unsent Core Broadcast draft. It cannot render, test, authorize, or send.",
      inputSchema: reviseBroadcastDraftInputSchema,
      outputSchema: reviseBroadcastDraftOutputSchema,
      annotations: draftMutation,
    },
    async (input) => result(await handler(input)),
  );
}

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
