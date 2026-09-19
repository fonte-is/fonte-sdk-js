import { McpServer } from "@modelcontextprotocol/server";

import { CLI_VERSION } from "./constants.js";
import { loadHostedConfig, type HostedConfig } from "./hosted-config.js";
import {
  MCP_SEQUENCE_TOOLS,
  type SequenceMcpClient,
  type SequenceMcpClientProvider,
} from "./mcp-sequence-tools.js";
import { registerMcpSequenceTools } from "./mcp-sequence-registration.js";
import { createCoreRequester } from "./operator-core-request.js";
import { createSequenceAuthoringClient } from "./operator-sequence-client.js";

export const MCP_SERVER_NAME = "fonte";
export const MCP_SEQUENCE_ALLOWLIST = { tools: MCP_SEQUENCE_TOOLS } as const;

export interface SequenceMcpSessionOptions {
  readonly configUrl?: string;
  readonly fetch: typeof fetch;
  authorize(config: HostedConfig, signal?: AbortSignal): Promise<string>;
  readonly signal?: AbortSignal;
}

/**
 * Keeps only one browser-authorized bearer in process memory. Core remains the
 * authority for all Sequence state and command replay.
 */
export function createEphemeralSequenceMcpSession(
  options: SequenceMcpSessionOptions,
): SequenceMcpClientProvider {
  let pending: Promise<SequenceMcpClient> | undefined;
  return async () => {
    pending ??= loadSequenceMcpClient(options).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

export function createFonteSequenceMcpServer(
  clientProvider: SequenceMcpClientProvider,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: CLI_VERSION },
    {
      instructions:
        "Authenticated Sequence draft authoring through Fonte Core. This server cannot activate, enroll, send, deliver, or manage recipients.",
    },
  );
  registerMcpSequenceTools(server, clientProvider);
  return server;
}

async function loadSequenceMcpClient(
  options: SequenceMcpSessionOptions,
): Promise<SequenceMcpClient> {
  const hosted = await loadHostedConfig(options.fetch, options.configUrl);
  const bearer = await options.authorize(hosted, options.signal);
  return createSequenceAuthoringClient(
    createCoreRequester({
      coreApiBaseUrl: hosted.coreApiBaseUrl,
      bearer,
      fetch: options.fetch,
      signal: options.signal,
    }),
  );
}
