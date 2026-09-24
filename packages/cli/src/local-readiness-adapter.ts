import type { ClientAuthRuntime } from "./client-auth-runtime.js";
import type { FonteReadinessReader } from "./mcp-readiness.js";
import type { FonteSetupDependencies } from "./local-setup.js";
import type { WorkspaceCatalogClientProvider } from "./mcp-workspace-catalog-tools.js";
import { createCodexMcpConfigStore } from "./codex-mcp-config.js";
import {
  inspectInstalledLocalMcpHost,
  locateInstalledLocalMcpHost,
  locateInstalledTrustedMcpHost,
} from "./local-mcp-host.js";
import { ensureTrustedMcpLaunchAgent } from "./trusted-mcp-host-launch-agent.js";
import { LocalWorkspaceContextStore } from "./local-workspace-context.js";

export interface LocalFonteReadinessReaderOptions {
  readonly auth: Pick<ClientAuthRuntime, "status" | "storageInfo">;
  readonly workspaceCatalog: WorkspaceCatalogClientProvider;
  readonly workspaceContext?: LocalWorkspaceContextStore;
  readonly inspectHost?: FonteReadinessReader["inspectHost"];
  readonly signal?: AbortSignal;
}

/** Adapts the existing login runtime, workspace client, and private selection. */
export function createLocalFonteReadinessReader(
  options: LocalFonteReadinessReaderOptions,
): FonteReadinessReader {
  const workspaceContext =
    options.workspaceContext ?? new LocalWorkspaceContextStore();
  return {
    inspectHost:
      options.inspectHost ??
      (async () => {
        const host = await locateInstalledLocalMcpHost();
        return inspectInstalledLocalMcpHost(host);
      }),
    async readSession() {
      const status = await options.auth.status(options.signal);
      const storage = await options.auth.storageInfo();
      return {
        status,
        storageAvailable:
          storage === undefined || storage.status === "available",
      };
    },
    async listWorkspaces() {
      return (await (await options.workspaceCatalog()).listWorkspaces()).map(
        ({ slug, name }) => ({ slug, name }),
      );
    },
    readSelectedWorkspace: () => workspaceContext.read(),
    writeSelectedWorkspace: (slug) => workspaceContext.select(slug),
  };
}

export function createLocalFonteSetupDependencies(
  options: LocalFonteReadinessReaderOptions,
): FonteSetupDependencies {
  return {
    ...createLocalFonteReadinessReader(options),
    codexConfig: createCodexMcpConfigStore(),
    locateInstalledHost: locateInstalledLocalMcpHost,
    async ensureTrustedHost() {
      if (process.platform !== "darwin" || process.arch !== "arm64") return;
      const host = await locateInstalledTrustedMcpHost();
      await ensureTrustedMcpLaunchAgent({ host });
    },
    inspectInstalledHost: inspectInstalledLocalMcpHost,
  };
}
