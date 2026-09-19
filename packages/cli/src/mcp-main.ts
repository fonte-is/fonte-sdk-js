#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createBrowserAuthorizationSession } from "./oauth.js";
import {
  createEphemeralSequenceMcpSession,
  createFonteSequenceMcpServer,
} from "./mcp-sequence-server.js";

const coreRequestLimitBytes = 1_048_576;
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
const authorization = createBrowserAuthorizationSession();

process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const session = createEphemeralSequenceMcpSession({
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: authorization.authorize,
    signal: cancellation.signal,
  });
  const server = createFonteSequenceMcpServer(session);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: coreRequestLimitBytes,
  });
  await server.connect(transport);
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
