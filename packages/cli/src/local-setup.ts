import {
  reconcileCodexMcpConfig,
  type CodexMcpConfigStore,
  type LocalMcpHostCommand,
} from "./codex-mcp-config.js";
import {
  unavailable,
  readFonteReadiness,
  type FonteReadiness,
  type FonteReadinessReader,
  type ReadFonteReadinessOptions,
} from "./mcp-readiness.js";

export interface FonteSetupDependencies extends Omit<
  FonteReadinessReader,
  "inspectHost"
> {
  readonly codexConfig: CodexMcpConfigStore;
  readonly locateInstalledHost: () => Promise<LocalMcpHostCommand>;
  readonly inspectInstalledHost: (host: LocalMcpHostCommand) => Promise<{
    readonly initialized: boolean;
    readonly tools: readonly string[];
  }>;
}

export interface FonteSetupOptions {
  readonly workspace?: string;
}

/** Configures the local Codex entry, then returns the shared readiness state. */
export async function runFonteSetup(
  dependencies: FonteSetupDependencies,
  options: FonteSetupOptions = {},
): Promise<FonteReadiness> {
  let host: LocalMcpHostCommand;
  try {
    host = await dependencies.locateInstalledHost();
  } catch {
    return unavailable("mcp_host_unavailable");
  }

  try {
    const original = await dependencies.codexConfig.readText();
    const plan = reconcileCodexMcpConfig(original, host);
    if (plan.changed)
      await dependencies.codexConfig.writeText(original, plan.text);
    const verified = reconcileCodexMcpConfig(
      await dependencies.codexConfig.readText(),
      host,
    );
    if (verified.changed) return unavailable("codex_configuration_unavailable");
  } catch {
    return unavailable("codex_configuration_unavailable");
  }

  const reader: FonteReadinessReader = {
    inspectHost: () => dependencies.inspectInstalledHost(host),
    readSession: dependencies.readSession,
    listWorkspaces: dependencies.listWorkspaces,
    readSelectedWorkspace: dependencies.readSelectedWorkspace,
    ...(dependencies.writeSelectedWorkspace
      ? { writeSelectedWorkspace: dependencies.writeSelectedWorkspace }
      : {}),
  };
  const readinessOptions: ReadFonteReadinessOptions = {
    selectUnambiguousWorkspace: true,
    ...(options.workspace !== undefined
      ? { workspace: options.workspace }
      : {}),
  };
  return readFonteReadiness(reader, readinessOptions);
}

/** Reads current local readiness without changing Codex or workspace settings. */
export async function readFonteStatus(
  dependencies: FonteSetupDependencies,
): Promise<FonteReadiness> {
  let host: LocalMcpHostCommand;
  try {
    host = await dependencies.locateInstalledHost();
  } catch {
    return unavailable("mcp_host_unavailable");
  }

  try {
    const config = await dependencies.codexConfig.readText();
    if (reconcileCodexMcpConfig(config, host).changed)
      return unavailable("codex_configuration_unavailable");
  } catch {
    return unavailable("codex_configuration_unavailable");
  }

  return readFonteReadiness({
    inspectHost: () => dependencies.inspectInstalledHost(host),
    readSession: dependencies.readSession,
    listWorkspaces: dependencies.listWorkspaces,
    readSelectedWorkspace: dependencies.readSelectedWorkspace,
  });
}
