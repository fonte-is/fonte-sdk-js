import type { McpServer } from "@modelcontextprotocol/server";

import type { FonteReadinessReader } from "./mcp-readiness.js";
import {
  createFonteStatusToolHandler,
  MCP_FONTE_STATUS_TOOL,
} from "./mcp-status-tools.js";
import {
  fonteStatusInputSchema,
  fonteStatusOutputSchema,
} from "./mcp-status-types.js";

export function registerFonteStatusTool(
  server: McpServer,
  reader: FonteReadinessReader,
): void {
  const status = createFonteStatusToolHandler(reader);
  server.registerTool(
    MCP_FONTE_STATUS_TOOL,
    {
      title: "Check Fonte readiness",
      description:
        "Reads the local Fonte sign-in, selected workspace, and installed tool readiness. Returns one readiness state and one next action. Does not change Fonte state.",
      inputSchema: fonteStatusInputSchema,
      outputSchema: fonteStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const value = await status(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
        structuredContent: value,
      };
    },
  );
}
