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
import {
  registerMcpBroadcastSendInstructionTools,
  MCP_BROADCAST_LEGACY_SEND_READ_TOOL,
} from "./mcp-broadcast-send-instruction-registration.js";
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
import { createCanonicalBroadcastClient } from "./operator-broadcast-canonical-send.js";
import { createAuthenticatedBroadcastProvider } from "./broadcast-runtime.js";
import {
  registerMcpBroadcastBgTools,
  type BroadcastMcpProvider,
} from "./mcp-broadcast-bg-tools.js";
import {
  createBroadcastRecipientSetClient,
  type BroadcastRecipientSetClient,
} from "./operator-broadcast-recipient-set-client.js";
import { createWorkspaceCatalogClient } from "./operator-workspace-catalog-client.js";
import { createSequenceAuthoringClient } from "./operator-sequence-client.js";
import { createCampaignMetadataClient } from "./operator-campaign-client.js";
import { createSegmentMetadataClient } from "./operator-segment-client.js";
import { registerMcpCampaignTools } from "./mcp-campaign-registration.js";
import { registerMcpSegmentTools } from "./mcp-segment-registration.js";
import { registerFonteStatusTool } from "./mcp-status-registration.js";
import type { FonteReadinessReader } from "./mcp-readiness.js";
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
export type BroadcastRecipientSetClientProvider =
  () => Promise<BroadcastRecipientSetClient>;
export interface FonteMcpClientProviders {
  readonly broadcastBg: BroadcastMcpProvider;
  readonly workspaceCatalog: WorkspaceCatalogClientProvider;
  readonly sequence: SequenceMcpClientProvider;
  readonly broadcastDraftLifecycle: BroadcastDraftLifecycleClientProvider;
  readonly broadcastDraftRevision: BroadcastDraftRevisionClientProvider;
  readonly broadcastSender: BroadcastSenderClientProvider;
  readonly broadcastTargeting: BroadcastTargetingClientProvider;
  readonly broadcastRenderTest: BroadcastRenderTestClientProvider;
  readonly broadcastSendInstruction: BroadcastSendInstructionClientProvider;
  readonly canonicalBroadcast: () => Promise<
    ReturnType<typeof createCanonicalBroadcastClient>
  >;
  readonly broadcastRecipientSets: BroadcastRecipientSetClientProvider;
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
    broadcastBg: createAuthenticatedBroadcastProvider(options),
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
    canonicalBroadcast: async () =>
      createCanonicalBroadcastClient((await authenticated()).request),
    broadcastRecipientSets: async () =>
      createBroadcastRecipientSetClient(
        (await authenticated()).request,
        readBroadcastLocalFile,
      ),
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
  registerMcpBroadcastBgTools(server, providers.broadcastBg);
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
    { readToolName: MCP_BROADCAST_LEGACY_SEND_READ_TOOL },
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
  "The normal Broadcast path is fonte_prepare_broadcast to request Core's review of an exact draft version, explicit user approval, then fonte_send_broadcast with the approved review references. Preparation never authorizes execution. Observe the returned operation URI with fonte_read_broadcast_send_operation. After response loss use fonte_recover_broadcast_request with the same saved request key; never generate another Send. Processing is not executable and an executable job is not evidence of provider acceptance. Changed inputs require an explicitly approved new review and a version-checked revision of the same unstarted operation. Existing authoring, testing, scheduling and historical control tools remain available. Sender discovery never guesses among ambiguous profiles. Initialize and tools/list never log in. Follow fonte_status for sign-in readiness; run fonte auth login outside MCP for secure-storage recovery. MCP never prompts, switches credential storage or switches workspaces.";
