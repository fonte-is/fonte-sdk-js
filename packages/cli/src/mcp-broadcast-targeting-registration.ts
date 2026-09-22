import type { McpServer } from "@modelcontextprotocol/server";

import {
  updateBroadcastTargetingInputSchema,
  updateBroadcastTargetingOutputSchema,
} from "./mcp-broadcast-targeting-types.js";
import {
  createBroadcastTargetingToolHandler,
  MCP_BROADCAST_TARGETING_UPDATE_TOOL,
  type BroadcastTargetingClientProvider,
} from "./mcp-broadcast-targeting-tools.js";

const targetMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpBroadcastTargetingTool(
  server: McpServer,
  provider: BroadcastTargetingClientProvider,
): void {
  const handler = createBroadcastTargetingToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_TARGETING_UPDATE_TOOL,
    {
      title: "Update Broadcast targeting",
      description:
        "Revision-checks exact Core To/Except definitions on one unsent draft. References must already be stable IDs; this does not resolve names, count recipients, prepare an audience, or send.",
      inputSchema: updateBroadcastTargetingInputSchema,
      outputSchema: updateBroadcastTargetingOutputSchema,
      annotations: targetMutation,
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
