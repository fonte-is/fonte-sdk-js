import { McpServer } from "@modelcontextprotocol/server";

import { CLI_VERSION } from "./constants.js";
import { registerMcpBroadcastHtmlPreparationTools } from "./mcp-broadcast-html-preparation-registration.js";
import { registerMcpWorkspaceCatalogTool } from "./mcp-workspace-catalog-registration.js";
import {
  MCP_BROADCAST_HTML_PREPARE_TOOL,
  MCP_BROADCAST_HTML_REVISE_TOOL,
  type BroadcastHtmlPreparationClientProvider,
} from "./mcp-broadcast-html-preparation-tools.js";
import { registerMcpBroadcastDraftLifecycleTools } from "./mcp-broadcast-draft-lifecycle-registration.js";
import {
  MCP_BROADCAST_DRAFT_CREATE_TOOL,
  MCP_BROADCAST_DRAFT_READ_TOOL,
  type BroadcastDraftLifecycleClientProvider,
} from "./mcp-broadcast-draft-lifecycle-tools.js";
import { registerMcpBroadcastDraftRevisionTool } from "./mcp-broadcast-draft-revision-registration.js";
import {
  MCP_BROADCAST_DRAFT_REVISION_TOOL,
  type BroadcastDraftRevisionClientProvider,
} from "./mcp-broadcast-draft-revision-tools.js";
import { registerMcpBroadcastRenderTestTools } from "./mcp-broadcast-render-test-registration.js";
import {
  MCP_BROADCAST_RENDER_TOOL,
  MCP_BROADCAST_TEST_READ_TOOL,
  MCP_BROADCAST_TEST_REQUEST_TOOL,
  type BroadcastRenderTestClientProvider,
} from "./mcp-broadcast-render-test-tools.js";
import { registerMcpBroadcastSenderTools } from "./mcp-broadcast-sender-registration.js";
import {
  MCP_BROADCAST_SENDER_LIST_TOOL,
  MCP_BROADCAST_SENDER_UPDATE_TOOL,
  type BroadcastSenderClientProvider,
} from "./mcp-broadcast-sender-tools.js";
import { registerMcpBroadcastTargetingTool } from "./mcp-broadcast-targeting-registration.js";
import { registerMcpBroadcastSendInstructionTools } from "./mcp-broadcast-send-instruction-registration.js";
import {
  MCP_BROADCAST_SCHEDULE_REPLACE_TOOL,
  MCP_BROADCAST_SCHEDULE_TOOL,
  MCP_BROADCAST_SEND_CANCEL_TOOL,
  MCP_BROADCAST_SEND_NOW_TOOL,
  MCP_BROADCAST_SEND_READ_TOOL,
  MCP_BROADCAST_SPEND_LIMIT_INCREASE_TOOL,
  type BroadcastSendInstructionClientProvider,
} from "./mcp-broadcast-send-instruction-tools.js";
import {
  MCP_BROADCAST_TARGETING_UPDATE_TOOL,
  type BroadcastTargetingClientProvider,
} from "./mcp-broadcast-targeting-tools.js";
import {
  MCP_WORKSPACE_LIST_TOOL,
  type WorkspaceCatalogClientProvider,
} from "./mcp-workspace-catalog-tools.js";
import {
  createMcpClientAuthProvider,
  type McpClientAuthOptions,
} from "./mcp-client-auth.js";
import { MCP_SEQUENCE_TOOLS } from "./mcp-sequence-tools.js";
import { registerMcpSequenceTools } from "./mcp-sequence-registration.js";
import { createBroadcastDraftLifecycleClient } from "./operator-broadcast-draft-lifecycle-client.js";
import { createBroadcastDraftRevisionClient } from "./operator-broadcast-draft-revision-client.js";
import { createBroadcastRenderTestClient } from "./operator-broadcast-render-test-client.js";
import { createBroadcastHtmlPreparationClient } from "./operator-broadcast-html-preparation.js";
import { readBroadcastLocalFile } from "./operator-broadcast-html-file.js";
import { createBroadcastSenderClient } from "./operator-broadcast-sender-client.js";
import { createBroadcastTargetingClient } from "./operator-broadcast-targeting-client.js";
import { createBroadcastSendInstructionClient } from "./operator-broadcast-send-instruction-client.js";
import { createWorkspaceCatalogClient } from "./operator-workspace-catalog-client.js";
import { createSequenceAuthoringClient } from "./operator-sequence-client.js";
import { createCampaignMetadataClient } from "./operator-campaign-client.js";
import { createSegmentMetadataClient } from "./operator-segment-client.js";
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
export const MCP_BROADCAST_TOOLS = [
  MCP_BROADCAST_DRAFT_CREATE_TOOL,
  MCP_BROADCAST_DRAFT_READ_TOOL,
  MCP_BROADCAST_DRAFT_REVISION_TOOL,
  MCP_BROADCAST_SENDER_LIST_TOOL,
  MCP_BROADCAST_SENDER_UPDATE_TOOL,
  MCP_BROADCAST_TARGETING_UPDATE_TOOL,
  MCP_BROADCAST_RENDER_TOOL,
  MCP_BROADCAST_TEST_REQUEST_TOOL,
  MCP_BROADCAST_TEST_READ_TOOL,
  MCP_BROADCAST_SEND_NOW_TOOL,
  MCP_BROADCAST_SCHEDULE_TOOL,
  MCP_BROADCAST_SEND_READ_TOOL,
  MCP_BROADCAST_SCHEDULE_REPLACE_TOOL,
  MCP_BROADCAST_SEND_CANCEL_TOOL,
  MCP_BROADCAST_SPEND_LIMIT_INCREASE_TOOL,
  MCP_BROADCAST_HTML_PREPARE_TOOL,
  MCP_BROADCAST_HTML_REVISE_TOOL,
] as const;
export const MCP_FONTE_TOOLS = [
  MCP_WORKSPACE_LIST_TOOL,
  ...MCP_SEQUENCE_TOOLS,
  ...MCP_BROADCAST_TOOLS,
  ...MCP_CAMPAIGN_TOOLS,
  ...MCP_SEGMENT_TOOLS,
] as const;
export const MCP_FONTE_ALLOWLIST = { tools: MCP_FONTE_TOOLS } as const;

export type SequenceMcpSessionOptions = McpClientAuthOptions;
export interface FonteMcpClientProviders {
  readonly workspaceCatalog: WorkspaceCatalogClientProvider;
  readonly sequence: SequenceMcpClientProvider;
  readonly broadcastDraftLifecycle: BroadcastDraftLifecycleClientProvider;
  readonly broadcastDraftRevision: BroadcastDraftRevisionClientProvider;
  readonly broadcastSender: BroadcastSenderClientProvider;
  readonly broadcastTargeting: BroadcastTargetingClientProvider;
  readonly broadcastRenderTest: BroadcastRenderTestClientProvider;
  readonly broadcastSendInstruction: BroadcastSendInstructionClientProvider;
  readonly broadcastHtmlPreparation: BroadcastHtmlPreparationClientProvider;
  readonly campaignMetadata: () => Promise<Awaited<ReturnType<typeof createCampaignMetadataClient>>>;
  readonly segmentMetadata: () => Promise<Awaited<ReturnType<typeof createSegmentMetadataClient>>>;
}

/** Gives every domain client the same current-custody boundary and requester. */
export function createDurableFonteMcpSession(
  options: SequenceMcpSessionOptions,
): FonteMcpClientProviders {
  const authenticated = createMcpClientAuthProvider(options);
  const lifecycle: BroadcastDraftLifecycleClientProvider = async () =>
    createBroadcastDraftLifecycleClient((await authenticated()).request);
  const revision: BroadcastDraftRevisionClientProvider = async () =>
    createBroadcastDraftRevisionClient((await authenticated()).request);
  const render: BroadcastRenderTestClientProvider = async () =>
    createBroadcastRenderTestClient((await authenticated()).request);
  const sender: BroadcastSenderClientProvider = async () => {
    const { request } = await authenticated();
    return createBroadcastSenderClient(
      request,
      createBroadcastDraftRevisionClient(request),
    );
  };
  const htmlPreparation = createBroadcastHtmlPreparationClient({
    readFile: readBroadcastLocalFile,
    lifecycle,
    revision,
    render,
  });
  return {
    workspaceCatalog: async () =>
      createWorkspaceCatalogClient((await authenticated()).request),
    sequence: async () =>
      createSequenceAuthoringClient((await authenticated()).request),
    broadcastDraftLifecycle: lifecycle,
    broadcastDraftRevision: revision,
    broadcastSender: sender,
    broadcastTargeting: async () =>
      createBroadcastTargetingClient((await authenticated()).request),
    broadcastSendInstruction: async () =>
      createBroadcastSendInstructionClient((await authenticated()).request),
    broadcastRenderTest: render,
    broadcastHtmlPreparation: async () => htmlPreparation,
    campaignMetadata: async () =>
      createCampaignMetadataClient((await authenticated()).request),
    segmentMetadata: async () =>
      createSegmentMetadataClient((await authenticated()).request),
  };
}

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
  const server = mcpServer(sequenceInstructions);
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

export function createFonteMcpServer(
  providers: FonteMcpClientProviders,
): McpServer {
  const server = mcpServer(fonteInstructions);
  registerMcpWorkspaceCatalogTool(server, providers.workspaceCatalog);
  registerMcpSequenceTools(server, providers.sequence);
  registerMcpBroadcastDraftLifecycleTools(
    server,
    providers.broadcastDraftLifecycle,
  );
  registerMcpBroadcastDraftRevisionTool(
    server,
    providers.broadcastDraftRevision,
  );
  registerMcpBroadcastSenderTools(server, providers.broadcastSender);
  registerMcpBroadcastTargetingTool(server, providers.broadcastTargeting);
  registerMcpBroadcastRenderTestTools(server, providers.broadcastRenderTest);
  registerMcpBroadcastSendInstructionTools(
    server,
    providers.broadcastSendInstruction,
  );
  registerMcpBroadcastHtmlPreparationTools(
    server,
    providers.broadcastHtmlPreparation,
  );
  registerMcpCampaignTools(server, providers.campaignMetadata);
  registerMcpSegmentTools(server, providers.segmentMetadata);
  return server;
}

function mcpServer(instructions: string): McpServer {
  return new McpServer(
    { name: MCP_SERVER_NAME, version: CLI_VERSION },
    { instructions },
  );
}

const sequenceInstructions =
  "The local fonte-mcp stdio host provides Sequence draft authoring and version activation through Fonte Core using the selected local Fonte credential store; it does not share credentials with hosted MCP or the legacy private transport. For login_required, login_changed, login_revoked, or login_refresh_uncertain, run fonte auth login outside MCP. For secure_storage_interaction_required, unlock the selected credential store and retry. For secure_storage_unavailable, run interactive fonte auth login to choose the supported per-user session file, then restart MCP. MCP never prompts or switches storage. This server cannot enroll, send, deliver, or manage recipients.";

const fonteInstructions =
  "The local fonte-mcp stdio host lists accessible workspaces and provides Sequence authoring plus content-first Broadcast draft create/read/update, local-file draft preparation, verified sender discovery and revision-fenced binding, stable-ID To/Except persistence, canonical render, verified-account test request/readback, and the v3 Send/Schedule operation through Fonte Core using the selected local Fonte session. Use a workspace slug returned by fonte_list_workspaces. Initialize and tools/list never log in. For login_required, login_changed, login_revoked, or login_refresh_uncertain, run fonte auth login outside MCP. For secure_storage_interaction_required, unlock the selected credential store and retry. For secure_storage_unavailable, run interactive fonte auth login to choose the supported per-user session file, then restart MCP. MCP never prompts or switches storage. Local-file preparation keeps one stable draft identity and never tests or sends. Sender discovery exact-matches verified Core profiles and never guesses among ambiguous choices. Target saves do not resolve names, count recipients, prepare an audience, or grant Send authority. Preview and tests are separate effects and never Send prerequisites. Status reads are observational; internal authorization/package/activation phases are described as Preparing unless diagnostics were requested. This host does not share credentials with hosted MCP or the legacy private transport.";
