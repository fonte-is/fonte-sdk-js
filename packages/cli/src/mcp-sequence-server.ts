import { McpServer } from "@modelcontextprotocol/server";

import { CLI_VERSION } from "./constants.js";
import {
  createMcpClientAuthProvider,
  type McpClientAuthOptions,
} from "./mcp-client-auth.js";
import {
  MCP_SEQUENCE_TOOLS,
  type SequenceMcpClientProvider,
} from "./mcp-sequence-tools.js";
import { registerMcpSequenceTools } from "./mcp-sequence-registration.js";
import { createSequenceAuthoringClient } from "./operator-sequence-client.js";

export const MCP_SERVER_NAME = "fonte";
export const MCP_SEQUENCE_ALLOWLIST = { tools: MCP_SEQUENCE_TOOLS } as const;

export type SequenceMcpSessionOptions = McpClientAuthOptions;

/** Rebuilds a bearer-bound client from current local custody at every tool boundary. */
export function createDurableSequenceMcpSession(
  options: SequenceMcpSessionOptions,
): SequenceMcpClientProvider {
  const authenticated = createMcpClientAuthProvider(options);
  return async () => {
    const boundary = await authenticated();
    return createSequenceAuthoringClient(boundary.request);
  };
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
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: CLI_VERSION },
    {
      instructions:
        "The local fonte-mcp stdio host provides Sequence draft authoring and version activation through Fonte Core using the current local Fonte customer session; it does not share credentials with hosted MCP or the legacy private transport. For login_required, login_changed, login_revoked, or login_refresh_uncertain, run fonte auth login outside MCP. For secure_storage_interaction_required, unlock the credential store and retry; for secure_storage_unavailable, use a supported credential environment. This server cannot enroll, send, deliver, or manage recipients.",
    },
  );
  registerMcpSequenceTools(server, clientProvider);
  return server;
}
