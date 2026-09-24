import { McpServer } from "@modelcontextprotocol/server";

import { CLI_VERSION } from "./constants.js";
import { registerMcpBroadcastHtmlPreparationTools } from "./mcp-broadcast-html-preparation-registration.js";
import { registerMcpWorkspaceCatalogTool } from "./mcp-workspace-catalog-registration.js";
import { type BroadcastHtmlPreparationClientProvider } from "./mcp-broadcast-html-preparation-tools.js";
import { registerMcpBroadcastDraftLifecycleTools } from "./mcp-broadcast-draft-lifecycle-registration.js";
import { type BroadcastDraftLifecycleClientProvider } from "./mcp-broadcast-draft-lifecycle-tools.js";
import { registerMcpBroadcastDraftRevisionTool } from "./mcp-broadcast-draft-revision-registration.js";
import { type BroadcastDraftRevisionClientProvider } from "./mcp-broadcast-draft-revision-tools.js";
import { registerMcpBroadcastRenderTestTools } from "./mcp-broadcast-render-test-registration.js";
import { type BroadcastRenderTestClientProvider } from "./mcp-broadcast-render-test-tools.js";
import { registerMcpBroadcastSenderTools } from "./mcp-broadcast-sender-registration.js";
import { type BroadcastSenderClientProvider } from "./mcp-broadcast-sender-tools.js";
import { registerMcpBroadcastTargetingTool } from "./mcp-broadcast-targeting-registration.js";
import { registerMcpBroadcastSendInstructionTools } from "./mcp-broadcast-send-instruction-registration.js";
import { type BroadcastSendInstructionClientProvider } from "./mcp-broadcast-send-instruction-tools.js";
import { type BroadcastTargetingClientProvider } from "./mcp-broadcast-targeting-tools.js";
import { type WorkspaceCatalogClientProvider } from "./mcp-workspace-catalog-tools.js";
import {
  createMcpClientAuthProvider,
  type McpClientAuthOptions,
} from "./mcp-client-auth.js";
import { registerMcpSequenceTools } from "./mcp-sequence-registration.js";
import type { SequenceMcpClientProvider } from "./mcp-sequence-tools.js";
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
import { registerMcpCampaignTools } from "./mcp-campaign-registration.js";
import { registerMcpSegmentTools } from "./mcp-segment-registration.js";
import { registerFonteStatusTool } from "./mcp-status-registration.js";
import type { FonteReadinessReader } from "./mcp-readiness.js";
import { registerMcpBroadcastPavedTools } from "./mcp-broadcast-paved-registration.js";
import {
  createBroadcastPavedOperator,
  type BroadcastPavedOperator,
} from "./operator-broadcast-paved.js";
import { createProductionDraftClient } from "./operator-production-draft-client.js";
import {
  createCoreOperatorClientWithRequester,
  type CoreOperatorClient,
} from "./operator-client.js";
export {
  MCP_BROADCAST_TOOLS,
  MCP_CAMPAIGN_SEGMENT_TOOLS,
  MCP_FONTE_ALLOWLIST,
  MCP_FONTE_TOOLS,
  MCP_SEQUENCE_ALLOWLIST,
} from "./mcp-tool-inventory.js";

export const MCP_SERVER_NAME = "fonte";

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
  readonly campaignMetadata: () => Promise<
    Awaited<ReturnType<typeof createCampaignMetadataClient>>
  >;
  readonly segmentMetadata: () => Promise<
    Awaited<ReturnType<typeof createSegmentMetadataClient>>
  >;
  readonly productionDrafts: () => Promise<
    Awaited<ReturnType<typeof createProductionDraftClient>>
  >;
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
    productionDrafts: async () =>
      createProductionDraftClient((await authenticated()).request),
  };
}

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
  readinessReader: FonteReadinessReader,
): McpServer {
  const server = mcpServer(fonteInstructions);
  registerFonteStatusTool(server, readinessReader);
  const broadcastPavedOperator: BroadcastPavedOperator =
    createBroadcastPavedOperator({
      workspaceCatalog: providers.workspaceCatalog,
      draftLifecycle: providers.broadcastDraftLifecycle,
      draftRevision: providers.broadcastDraftRevision,
      senders: providers.broadcastSender,
      targeting: providers.broadcastTargeting,
      productionDrafts: providers.productionDrafts,
      render: providers.broadcastRenderTest,
      send: providers.broadcastSendInstruction,
      readFile: readBroadcastLocalFile,
    });
  registerMcpBroadcastPavedTools(server, broadcastPavedOperator);
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
  "The local Fonte MCP client connects to the trusted per-user Fonte host, which performs authenticated calls to Fonte Core. Initialize and tools/list never sign in. For login_required, login_changed, login_revoked, or login_refresh_uncertain, call fonte_status and follow its single next_action; run fonte auth login only when that action requests sign-in. If the local host is unavailable, run fonte setup. MCP never prompts for authentication, changes the signed-in account, or switches workspaces. This server cannot enroll, send, deliver, or manage recipients.";

const fonteInstructions =
  "The local Fonte host provides fonte_status, fonte_prepare_broadcast, and fonte_send_broadcast as the normal Broadcast path. Use fonte_prepare_broadcast repeatedly as needed; it does not Send, Schedule, Test Send, prepare audiences, or call providers. Send is a separate explicit action and requires the exact send_input returned by a ready_to_send preparation. If preparation asks for missing information or choices, resolve only that prompt before preparing again. The host also exposes workspace discovery, existing Sequence and Broadcast operations, including verified-account test request/readback, and Campaign/Segment metadata. Sender discovery matches verified profiles and does not guess among ambiguous choices. Initialize and tools/list never sign in. For sign-in readiness, follow the one next_action from fonte_status; run fonte auth login only when that next_action requests sign-in. If the local host is unavailable, run fonte setup. MCP never prompts for authentication, changes the signed-in account, or switches workspaces.";
