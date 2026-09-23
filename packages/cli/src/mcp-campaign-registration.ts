import type { McpServer } from "@modelcontextprotocol/server";

import {
  createCampaignToolHandlers,
  MCP_CAMPAIGN_TOOLS,
  type CampaignMcpClientProvider,
} from "./mcp-campaign-tools.js";
import {
  campaignOperatorReceiptSchema,
  createCampaignInputSchema,
  listCampaignsInputSchema,
  readCampaignCommandInputSchema,
  readCampaignInputSchema,
  updateCampaignInputSchema,
} from "./mcp-campaign-types.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const reversibleMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpCampaignTools(
  server: McpServer,
  provider: CampaignMcpClientProvider,
): void {
  const handlers = createCampaignToolHandlers(provider);
  const outputSchema = campaignOperatorReceiptSchema;
  server.registerTool(
    MCP_CAMPAIGN_TOOLS[0],
    {
      title: "List Campaign metadata",
      description:
        "Lists Core-authorized Campaign metadata for one workspace and environment.",
      inputSchema: listCampaignsInputSchema,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.list(input)),
  );
  server.registerTool(
    MCP_CAMPAIGN_TOOLS[1],
    {
      title: "Read Campaign metadata",
      description: "Reads one exact Core-owned Campaign configuration.",
      inputSchema: readCampaignInputSchema,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.read(input)),
  );
  server.registerTool(
    MCP_CAMPAIGN_TOOLS[2],
    {
      title: "Create Campaign metadata",
      description:
        "Creates one Campaign configuration with caller-owned Campaign and operation UUIDs.",
      inputSchema: createCampaignInputSchema,
      outputSchema,
      annotations: reversibleMutation,
    },
    async (input) => result(await handlers.create(input)),
  );
  server.registerTool(
    MCP_CAMPAIGN_TOOLS[3],
    {
      title: "Update Campaign metadata",
      description:
        "Revision-checks and updates the explicit full Campaign configuration, including archive state.",
      inputSchema: updateCampaignInputSchema,
      outputSchema,
      annotations: reversibleMutation,
    },
    async (input) => result(await handlers.update(input)),
  );
  server.registerTool(
    MCP_CAMPAIGN_TOOLS[4],
    {
      title: "Read Campaign command receipt",
      description: "Reads the Core receipt for one Campaign operation UUID.",
      inputSchema: readCampaignCommandInputSchema,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.receipt(input)),
  );
}

function result<Value extends object>(value: Value) {
  const blocked = "outcome" in value && value.outcome === "blocked";
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(blocked ? { isError: true } : {}),
  };
}
