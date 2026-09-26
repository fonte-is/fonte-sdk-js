import type { CampaignMetadataClient } from "./operator-campaign-client.js";
import {
  campaignFailureReceipt,
  runCampaignOperatorCommand,
} from "./operator-campaign-run.js";
import type {
  CampaignOperatorCommand,
  CampaignOperatorReceipt,
} from "./operator-campaign-types.js";
import {
  createCampaignInputSchema,
  listCampaignsInputSchema,
  readCampaignCommandInputSchema,
  readCampaignInputSchema,
  updateCampaignInputSchema,
} from "./mcp-campaign-types.js";

export const MCP_CAMPAIGN_TOOLS = [
  "fonte_list_campaigns",
  "fonte_read_campaign",
  "fonte_create_campaign",
  "fonte_update_campaign",
  "fonte_read_campaign_command",
] as const;

export type CampaignMcpClientProvider = () => Promise<CampaignMetadataClient>;

export interface CampaignToolHandlers {
  list(input: unknown): Promise<CampaignOperatorReceipt>;
  read(input: unknown): Promise<CampaignOperatorReceipt>;
  create(input: unknown): Promise<CampaignOperatorReceipt>;
  update(input: unknown): Promise<CampaignOperatorReceipt>;
  receipt(input: unknown): Promise<CampaignOperatorReceipt>;
}

export function createCampaignToolHandlers(
  provider: CampaignMcpClientProvider,
): CampaignToolHandlers {
  return {
    async list(input) {
      const value = listCampaignsInputSchema.parse(input);
      return run({ kind: "campaign_list", ...value }, provider);
    },
    async read(input) {
      const value = readCampaignInputSchema.parse(input);
      return run({ kind: "campaign_read", ...value }, provider);
    },
    async create(input) {
      const value = createCampaignInputSchema.parse(input);
      return run({ kind: "campaign_create", ...value }, provider);
    },
    async update(input) {
      const value = updateCampaignInputSchema.parse(input);
      return run({ kind: "campaign_update", ...value }, provider);
    },
    async receipt(input) {
      const value = readCampaignCommandInputSchema.parse(input);
      return run({ kind: "campaign_receipt", ...value }, provider);
    },
  };
}

async function run(
  command: CampaignOperatorCommand,
  provider: CampaignMcpClientProvider,
): Promise<CampaignOperatorReceipt> {
  try {
    return await runCampaignOperatorCommand(command, await provider());
  } catch (error) {
    return campaignFailureReceipt(command, error);
  }
}
