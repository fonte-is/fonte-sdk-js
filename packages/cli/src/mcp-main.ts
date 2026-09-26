#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createClientAuthRuntime } from "./client-auth-runtime.js";
import { withLoginLock } from "./login-lock.js";
import { createLocalFonteReadinessReader } from "./local-readiness-adapter.js";
import {
  createDurableFonteMcpSession,
  createFonteMcpServer,
} from "./mcp-sequence-server.js";

const coreRequestLimitBytes = 1_048_576;
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
const authorization = createClientAuthRuntime({
  fetch: globalThis.fetch,
  configUrl: process.env.FONTE_CLI_CONFIG_URL,
  noninteractiveValue: () => process.env.FONTE_NONINTERACTIVE ?? "1",
  withLock: (operation, signal) => withLoginLock(operation, signal),
});

process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const session = createDurableFonteMcpSession({
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: authorization.authorize,
    renewAuthorization: authorization.renewAuthorization,
    signal: cancellation.signal,
  });
  const readinessReader = createLocalFonteReadinessReader({
    auth: authorization,
    workspaceCatalog: session.workspaceCatalog,
    signal: cancellation.signal,
  });
  const server = createFonteMcpServer(session, readinessReader);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: coreRequestLimitBytes,
  });
  await server.connect(transport);
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
