import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createFonteSequenceMcpServer } from "../../packages/cli/dist/mcp-sequence-server.js";
import { registerMcpCampaignTools } from "../../packages/cli/dist/mcp-campaign-registration.js";
import { registerMcpSegmentTools } from "../../packages/cli/dist/mcp-segment-registration.js";
import { createCampaignMetadataClient } from "../../packages/cli/dist/operator-campaign-client.js";
import { createSegmentMetadataClient } from "../../packages/cli/dist/operator-segment-client.js";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "11111111-1111-4111-8111-111111111111";
const segmentId = "22222222-2222-4222-8222-222222222222";
const contexts = async () => [
  {
    workspace_id: tenantId,
    account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspace_slug: "acme-workspace",
    workspace_code: "acme",
    display_name: "Acme",
    role: "operator",
    available_environments: ["sandbox"],
  },
];

const campaignConfiguration = {
  workspaceId: tenantId,
  environment: "sandbox",
  campaignId,
  revision: 1,
  title: "Autumn",
  description: "",
  archived: false,
  createdAt: "2026-09-23T12:00:00.000Z",
  updatedAt: "2026-09-23T12:00:00.000Z",
  scopeBindingStatus: "not_qualified",
};
const segmentItem = {
  segmentId,
  revision: 1,
  title: "Active",
  archived: false,
  createdAt: "2026-09-23T12:00:00.000Z",
  updatedAt: "2026-09-23T12:00:00.000Z",
};

const request = async (path) => {
  if (path.includes("campaign-configurations")) {
    return {
      schemaVersion: "campaign_configuration.v1",
      tenantId,
      environment: "sandbox",
      configurations: [campaignConfiguration],
      nextCursor: null,
    };
  }
  if (path.endsWith("/segments?environment=sandbox")) {
    return {
      schemaVersion: "native_segment.v1",
      tenantId,
      environment: "sandbox",
      segments: [segmentItem],
      nextCursor: null,
    };
  }
  throw new Error("fixture endpoint not found");
};

const existingServer = createFonteSequenceMcpServer(async () => ({}));
registerMcpCampaignTools(existingServer, async () =>
  createCampaignMetadataClient(request, contexts),
);
registerMcpSegmentTools(existingServer, async () =>
  createSegmentMetadataClient(request, contexts),
);
await existingServer.connect(
  new StdioServerTransport(process.stdin, process.stdout),
);
