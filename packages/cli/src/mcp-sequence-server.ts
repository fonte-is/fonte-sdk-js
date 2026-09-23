import { McpServer } from "@modelcontextprotocol/server";

import { CLI_VERSION } from "./constants.js";
import {
  createMcpClientAuthProvider,
  type McpClientAuthOptions,
} from "./mcp-client-auth.js";
import { MCP_SEQUENCE_TOOLS } from "./mcp-sequence-tools.js";
import { registerMcpSequenceTools } from "./mcp-sequence-registration.js";
import { MCP_CAMPAIGN_TOOLS } from "./mcp-campaign-tools.js";
import { registerMcpCampaignTools } from "./mcp-campaign-registration.js";
import { MCP_SEGMENT_TOOLS } from "./mcp-segment-tools.js";
import { registerMcpSegmentTools } from "./mcp-segment-registration.js";
import {
  createCoreOperatorClientWithRequester,
  type CoreOperatorClient,
} from "./operator-client.js";

export const MCP_SERVER_NAME = "fonte";
export const MCP_SEQUENCE_ALLOWLIST = { tools: MCP_SEQUENCE_TOOLS } as const;
export const MCP_FONTE_TOOLS = [
  ...MCP_SEQUENCE_TOOLS,
  ...MCP_CAMPAIGN_TOOLS,
  ...MCP_SEGMENT_TOOLS,
] as const;
export const MCP_FONTE_ALLOWLIST = { tools: MCP_FONTE_TOOLS } as const;

export type SequenceMcpSessionOptions = McpClientAuthOptions;
export type FonteMcpClientProvider = () => Promise<CoreOperatorClient>;

/** Rebuilds a bearer-bound client from current local custody at every tool boundary. */
export function createDurableSequenceMcpSession(
  options: SequenceMcpSessionOptions,
): FonteMcpClientProvider {
  const authenticated = createMcpClientAuthProvider(options);
  return async () => {
    const boundary = await authenticated();
    return createCoreOperatorClientWithRequester(boundary.request);
  };
}

/** Compatibility name for the original Sequence-only host factory. */
export function createEphemeralSequenceMcpSession(
  options: SequenceMcpSessionOptions,
): FonteMcpClientProvider {
  return createDurableSequenceMcpSession(options);
}

export function createFonteSequenceMcpServer(
  clientProvider: FonteMcpClientProvider,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: CLI_VERSION },
    {
      instructions:
        "The local fonte-mcp stdio host provides Sequence authoring, Campaign metadata, and native Segment metadata through Fonte Core using the current local Fonte customer session; Segment rules are not evaluated here and no memberships are inferred. It does not share credentials with hosted MCP or the legacy private transport. For login_required, login_changed, login_revoked, or login_refresh_uncertain, run fonte auth login outside MCP. For secure_storage_interaction_required, unlock the credential store and retry; for secure_storage_unavailable, use a supported credential environment. This server cannot enroll, send, deliver, or manage recipients.",
    },
  );
  registerMcpSequenceTools(server, clientProvider);
  registerMcpCampaignTools(
    server,
    async () => (await clientProvider()).campaignMetadata,
  );
  registerMcpSegmentTools(
    server,
    async () => (await clientProvider()).segmentMetadata,
  );
  return server;
}
