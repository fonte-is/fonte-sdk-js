#!/usr/bin/env node

try {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("local_mcp_host_unavailable");
  const { runTrustedMcpClient } = await import("./trusted-mcp-ipc.js");
  await runTrustedMcpClient();
} catch {
  process.stderr.write(
    "Fonte isn't running locally. Run fonte setup, then try again.\n",
  );
  process.exitCode = 1;
}
