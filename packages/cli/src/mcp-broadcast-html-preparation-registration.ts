import type { McpServer } from "@modelcontextprotocol/server";

import { broadcastHtmlPreparationOutputSchema } from "./mcp-broadcast-html-preparation-types.js";
import {
  prepareBroadcastHtmlInputSchema,
  reviseBroadcastHtmlInputSchema,
} from "./mcp-broadcast-html-preparation-types.js";
import {
  createBroadcastHtmlPrepareToolHandler,
  createBroadcastHtmlReviseToolHandler,
  MCP_BROADCAST_HTML_PREPARE_TOOL,
  MCP_BROADCAST_HTML_REVISE_TOOL,
  type BroadcastHtmlPreparationClientProvider,
} from "./mcp-broadcast-html-preparation-tools.js";

const mutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpBroadcastHtmlPreparationTools(
  server: McpServer,
  provider: BroadcastHtmlPreparationClientProvider,
): void {
  const prepare = createBroadcastHtmlPrepareToolHandler(provider);
  const revise = createBroadcastHtmlReviseToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_HTML_PREPARE_TOOL,
    {
      title: "Prepare Broadcast from HTML file",
      description:
        "Reads, hashes and reports one local complete-HTML file, creates one stable incomplete draft, reads it back and renders that exact revision. It never tests or sends.",
      inputSchema: prepareBroadcastHtmlInputSchema,
      outputSchema: broadcastHtmlPreparationOutputSchema,
      annotations: mutation,
    },
    async (input) => response(await prepare(input)),
  );
  server.registerTool(
    MCP_BROADCAST_HTML_REVISE_TOOL,
    {
      title: "Revise Broadcast from HTML file",
      description:
        "Reads and reports a corrected local HTML file, revision-fences the same draft, reads it back and renders the exact new revision. It never tests or sends.",
      inputSchema: reviseBroadcastHtmlInputSchema,
      outputSchema: broadcastHtmlPreparationOutputSchema,
      annotations: mutation,
    },
    async (input) => response(await revise(input)),
  );
}

function response<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
