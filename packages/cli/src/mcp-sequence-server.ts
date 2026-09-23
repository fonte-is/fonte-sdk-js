import { McpServer } from "@modelcontextprotocol/server";

import { CLI_VERSION } from "./constants.js";
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
  createMcpClientAuthProvider,
  type McpClientAuthOptions,
} from "./mcp-client-auth.js";
import {
  MCP_SEQUENCE_TOOLS,
  type SequenceMcpClientProvider,
} from "./mcp-sequence-tools.js";
import { registerMcpSequenceTools } from "./mcp-sequence-registration.js";
import { createBroadcastDraftLifecycleClient } from "./operator-broadcast-draft-lifecycle-client.js";
import { createBroadcastDraftRevisionClient } from "./operator-broadcast-draft-revision-client.js";
import { createBroadcastRenderTestClient } from "./operator-broadcast-render-test-client.js";
import { createBroadcastTargetingClient } from "./operator-broadcast-targeting-client.js";
import { createBroadcastSendInstructionClient } from "./operator-broadcast-send-instruction-client.js";
import { createSequenceAuthoringClient } from "./operator-sequence-client.js";

export const MCP_SERVER_NAME = "fonte";
export const MCP_SEQUENCE_ALLOWLIST = { tools: MCP_SEQUENCE_TOOLS } as const;
export const MCP_BROADCAST_TOOLS = [
  MCP_BROADCAST_DRAFT_CREATE_TOOL,
  MCP_BROADCAST_DRAFT_READ_TOOL,
  MCP_BROADCAST_DRAFT_REVISION_TOOL,
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
] as const;
export const MCP_FONTE_ALLOWLIST = {
  tools: [...MCP_SEQUENCE_TOOLS, ...MCP_BROADCAST_TOOLS],
} as const;

export type SequenceMcpSessionOptions = McpClientAuthOptions;
export interface FonteMcpClientProviders {
  readonly sequence: SequenceMcpClientProvider;
  readonly broadcastDraftLifecycle: BroadcastDraftLifecycleClientProvider;
  readonly broadcastDraftRevision: BroadcastDraftRevisionClientProvider;
  readonly broadcastTargeting: BroadcastTargetingClientProvider;
  readonly broadcastRenderTest: BroadcastRenderTestClientProvider;
  readonly broadcastSendInstruction: BroadcastSendInstructionClientProvider;
}

/** Gives every domain client the same current-custody boundary and requester. */
export function createDurableFonteMcpSession(
  options: SequenceMcpSessionOptions,
): FonteMcpClientProviders {
  const authenticated = createMcpClientAuthProvider(options);
  return {
    sequence: async () =>
      createSequenceAuthoringClient((await authenticated()).request),
    broadcastDraftLifecycle: async () =>
      createBroadcastDraftLifecycleClient((await authenticated()).request),
    broadcastDraftRevision: async () =>
      createBroadcastDraftRevisionClient((await authenticated()).request),
    broadcastTargeting: async () =>
      createBroadcastTargetingClient((await authenticated()).request),
    broadcastRenderTest: async () =>
      createBroadcastRenderTestClient((await authenticated()).request),
    broadcastSendInstruction: async () =>
      createBroadcastSendInstructionClient((await authenticated()).request),
  };
}

/** Rebuilds a bearer-bound client from current local custody at every tool boundary. */
export function createDurableSequenceMcpSession(
  options: SequenceMcpSessionOptions,
): SequenceMcpClientProvider {
  return createDurableFonteMcpSession(options).sequence;
}

/** Compatibility name for the original Sequence-only host factory. */
export function createEphemeralSequenceMcpSession(
  options: SequenceMcpSessionOptions,
): SequenceMcpClientProvider {
  return createDurableSequenceMcpSession(options);
}

export function createFonteSequenceMcpServer(
  clientProvider: SequenceMcpClientProvider,
): McpServer {
  const server = mcpServer(sequenceInstructions);
  registerMcpSequenceTools(server, clientProvider);
  return server;
}

export function createFonteMcpServer(
  providers: FonteMcpClientProviders,
): McpServer {
  const server = mcpServer(fonteInstructions);
  registerMcpSequenceTools(server, providers.sequence);
  registerMcpBroadcastDraftLifecycleTools(
    server,
    providers.broadcastDraftLifecycle,
  );
  registerMcpBroadcastDraftRevisionTool(
    server,
    providers.broadcastDraftRevision,
  );
  registerMcpBroadcastTargetingTool(server, providers.broadcastTargeting);
  registerMcpBroadcastRenderTestTools(server, providers.broadcastRenderTest);
  registerMcpBroadcastSendInstructionTools(
    server,
    providers.broadcastSendInstruction,
  );
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
  "The local fonte-mcp stdio host provides Sequence authoring plus content-first Broadcast draft create/read/update, exact stable-ID To/Except persistence, verified sender discovery and binding, canonical render, verified-account test request/readback, and the v3 Send/Schedule operation through Fonte Core using the selected local Fonte session. Initialize and tools/list never log in. For login_required, login_changed, login_revoked, or login_refresh_uncertain, run fonte auth login outside MCP. For secure_storage_interaction_required, unlock the selected credential store and retry. For secure_storage_unavailable, run interactive fonte auth login to choose the supported per-user session file, then restart MCP. MCP never prompts or switches storage. Target saves do not resolve names, count recipients, prepare an audience, or grant Send authority. Preview and tests are optional separate effects and never Send prerequisites. Status reads are observational; internal authorization/package/activation phases are described as Preparing unless diagnostics were requested. This host does not share credentials with hosted MCP or the legacy private transport.";
