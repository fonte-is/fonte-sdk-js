import type { McpServer } from "@modelcontextprotocol/server";

import {
  listWorkspacesInputSchema,
  listWorkspacesOutputSchema,
} from "./mcp-workspace-catalog-types.js";
import {
  createListWorkspacesToolHandler,
  MCP_WORKSPACE_LIST_TOOL,
  type WorkspaceCatalogClientProvider,
} from "./mcp-workspace-catalog-tools.js";

export function registerMcpWorkspaceCatalogTool(
  server: McpServer,
  provider: WorkspaceCatalogClientProvider,
): void {
  const list = createListWorkspacesToolHandler(provider);
  server.registerTool(
    MCP_WORKSPACE_LIST_TOOL,
    {
      title: "List accessible workspaces",
      description:
        "Lists workspaces available to the signed-in Fonte account. Use an exact returned slug as the workspace value for other Fonte tools; slugs are never guessed.",
      inputSchema: listWorkspacesInputSchema,
      outputSchema: listWorkspacesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const value = await list(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
        structuredContent: value,
      };
    },
  );
}
