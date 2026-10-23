#!/usr/bin/env node

import {
  startTrustedMcpHost,
  trustedMcpSocketPath,
} from "./trusted-mcp-ipc.js";

const cancel = new AbortController();
process.once("SIGINT", () => cancel.abort());
process.once("SIGTERM", () => cancel.abort());

try {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("trusted_mcp_platform_unsupported");

  const [
    { StdioServerTransport },
    { createClientAuthRuntime },
    { withLoginLock },
    { createLocalFonteReadinessReader },
    { createDurableFonteMcpSession, createFonteMcpServer },
  ] = await Promise.all([
    import("@modelcontextprotocol/server/stdio"),
    import("./client-auth-runtime.js"),
    import("./login-lock.js"),
    import("./local-readiness-adapter.js"),
    import("./mcp-sequence-server.js"),
  ]);
  const authorization = createClientAuthRuntime({
    fetch: globalThis.fetch,
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    noninteractiveValue: () => "1",
    withLock: (operation, signal) => withLoginLock(operation, signal),
  });
  const session = createDurableFonteMcpSession({
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: authorization.authorize,
    renewAuthorization: authorization.renewAuthorization,
    signal: cancel.signal,
  });
  const readinessReader = createLocalFonteReadinessReader({
    auth: authorization,
    workspaceCatalog: session.workspaceCatalog,
    signal: cancel.signal,
  });
  const host = await startTrustedMcpHost({
    socketPath: trustedMcpSocketPath(),
    async handleClient(client) {
      const server = createFonteMcpServer(session, readinessReader);
      const transport = new StdioServerTransport(client, client, {
        maxBufferSize: 1_048_576,
      });
      await server.connect(transport);
    },
  });

  if (cancel.signal.aborted) await host.close();
  else
    await new Promise<void>((resolve) => {
      cancel.signal.addEventListener(
        "abort",
        () => {
          void host.close().finally(resolve);
        },
        { once: true },
      );
    });
} catch {
  process.stderr.write(
    "Fonte local service could not start. Run fonte setup again.\n",
  );
  process.exitCode = 1;
}
