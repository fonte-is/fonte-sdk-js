import type { SessionStatus } from "./client-auth-types.js";
import { CLI_VERSION } from "./constants.js";
import {
  MCP_BROADCAST_DRAFT_CREATE_TOOL,
  MCP_BROADCAST_DRAFT_READ_TOOL,
} from "./mcp-broadcast-draft-lifecycle-tools.js";
import { MCP_BROADCAST_DRAFT_REVISION_TOOL } from "./mcp-broadcast-draft-revision-tools.js";
import {
  MCP_BROADCAST_HTML_PREPARE_TOOL,
  MCP_BROADCAST_HTML_REVISE_TOOL,
} from "./mcp-broadcast-html-preparation-tools.js";
import {
  MCP_BROADCAST_RENDER_TOOL,
  MCP_BROADCAST_TEST_READ_TOOL,
  MCP_BROADCAST_TEST_REQUEST_TOOL,
} from "./mcp-broadcast-render-test-tools.js";
import {
  MCP_BROADCAST_SENDER_LIST_TOOL,
  MCP_BROADCAST_SENDER_UPDATE_TOOL,
} from "./mcp-broadcast-sender-tools.js";
import {
  MCP_BROADCAST_SCHEDULE_REPLACE_TOOL,
  MCP_BROADCAST_SCHEDULE_TOOL,
  MCP_BROADCAST_SEND_CANCEL_TOOL,
  MCP_BROADCAST_SEND_NOW_TOOL,
  MCP_BROADCAST_SEND_READ_TOOL,
  MCP_BROADCAST_SPEND_LIMIT_INCREASE_TOOL,
} from "./mcp-broadcast-send-instruction-tools.js";
import { MCP_BROADCAST_TARGETING_UPDATE_TOOL } from "./mcp-broadcast-targeting-tools.js";
import { MCP_SEQUENCE_TOOLS } from "./mcp-sequence-tools.js";
import { MCP_WORKSPACE_LIST_TOOL } from "./mcp-workspace-catalog-tools.js";

export const MCP_PRODUCT_CAPABILITY_VERSION = "fonte-mcp-catalog.v1" as const;

export const REQUIRED_PRODUCT_TOOLS = [
  MCP_WORKSPACE_LIST_TOOL,
  ...MCP_SEQUENCE_TOOLS,
  MCP_BROADCAST_DRAFT_CREATE_TOOL,
  MCP_BROADCAST_DRAFT_READ_TOOL,
  MCP_BROADCAST_DRAFT_REVISION_TOOL,
  MCP_BROADCAST_SENDER_LIST_TOOL,
  MCP_BROADCAST_SENDER_UPDATE_TOOL,
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
  MCP_BROADCAST_HTML_PREPARE_TOOL,
  MCP_BROADCAST_HTML_REVISE_TOOL,
] as const;

export type ReadinessState =
  | "ready"
  | "login_required"
  | "workspace_required"
  | "repair_required"
  | "unavailable";

export type ReadinessReason =
  | "mcp_host_unavailable"
  | "required_tools_missing"
  | "local_sign_in_unavailable"
  | "codex_configuration_unavailable"
  | "workspace_context_unavailable"
  | "sign_in_required"
  | "workspace_catalog_unavailable"
  | "workspace_access_required"
  | "workspace_selection_required";

export interface ReadinessWorkspace {
  readonly slug: string;
  readonly name: string;
}

export interface FonteReadiness {
  readonly schema: "fonte.readiness.v1";
  readonly state: ReadinessState;
  readonly reason: ReadinessReason | null;
  readonly next_action: string | null;
  readonly cli_version: string;
  readonly capability_version: typeof MCP_PRODUCT_CAPABILITY_VERSION;
  readonly authentication: "ready" | "required" | "unavailable" | "not_checked";
  readonly selected_workspace: ReadinessWorkspace | null;
  readonly workspace_choices: readonly ReadinessWorkspace[];
  readonly more_workspace_choices: boolean;
  readonly missing_tools: readonly string[];
}

export interface FonteReadinessReader {
  inspectHost(): Promise<{
    readonly initialized: boolean;
    readonly tools: readonly string[];
  }>;
  readSession(): Promise<{
    readonly status: SessionStatus;
    readonly storageAvailable: boolean;
  }>;
  listWorkspaces(): Promise<readonly ReadinessWorkspace[]>;
  readSelectedWorkspace(): Promise<string | null>;
  writeSelectedWorkspace?(slug: string): Promise<void>;
}

export interface ReadFonteReadinessOptions {
  /** Setup may persist an explicit or single unambiguous workspace choice. */
  readonly workspace?: string;
  readonly selectUnambiguousWorkspace?: boolean;
}

const maxWorkspaceChoices = 20;

/** The shared bounded readiness projection for local setup and fonte_status. */
export async function readFonteReadiness(
  reader: FonteReadinessReader,
  options: ReadFonteReadinessOptions = {},
): Promise<FonteReadiness> {
  let host: Awaited<ReturnType<FonteReadinessReader["inspectHost"]>>;
  try {
    host = await reader.inspectHost();
  } catch {
    return unavailable("mcp_host_unavailable");
  }
  if (!host.initialized) return unavailable("mcp_host_unavailable");

  const exposed = new Set(host.tools);
  const missingTools = REQUIRED_PRODUCT_TOOLS.filter(
    (name) => !exposed.has(name),
  );
  if (missingTools.length > 0)
    return readiness({
      state: "repair_required",
      reason: "required_tools_missing",
      nextAction:
        "Update Fonte CLI to a build with the required tools, then run fonte setup again.",
      missing_tools: missingTools,
    });

  let auth: Awaited<ReturnType<FonteReadinessReader["readSession"]>>;
  try {
    auth = await reader.readSession();
  } catch {
    return unavailable("local_sign_in_unavailable", "unavailable");
  }
  if (!auth.storageAvailable)
    return unavailable("local_sign_in_unavailable", "unavailable");
  if (auth.status.state !== "ready") {
    const activeLogin = auth.status.state === "login_pending";
    return readiness({
      state: "login_required",
      reason: "sign_in_required",
      nextAction: activeLogin
        ? "Finish the current sign-in, then run fonte setup again."
        : "Run fonte auth login once, then run fonte setup again.",
      authentication: "required",
    });
  }

  let workspaces: readonly ReadinessWorkspace[];
  let selected: string | null;
  try {
    workspaces = await reader.listWorkspaces();
    selected = await reader.readSelectedWorkspace();
  } catch {
    return unavailable("workspace_catalog_unavailable", "ready");
  }

  if (options.workspace !== undefined) {
    const requested = workspaces.find(
      (workspace) => workspace.slug === options.workspace,
    );
    if (!requested)
      return workspaceRequired(workspaces, "workspace_selection_required");
    if (!reader.writeSelectedWorkspace)
      return workspaceRequired(workspaces, "workspace_selection_required");
    try {
      await reader.writeSelectedWorkspace(requested.slug);
      selected = await reader.readSelectedWorkspace();
      if (selected !== requested.slug)
        return unavailable("workspace_context_unavailable", "ready");
    } catch {
      return unavailable("workspace_context_unavailable", "ready");
    }
  } else if (
    options.selectUnambiguousWorkspace &&
    workspaces.length === 1 &&
    selected !== workspaces[0]!.slug
  ) {
    if (!reader.writeSelectedWorkspace)
      return workspaceRequired(workspaces, "workspace_selection_required");
    try {
      await reader.writeSelectedWorkspace(workspaces[0]!.slug);
      selected = await reader.readSelectedWorkspace();
      if (selected !== workspaces[0]!.slug)
        return unavailable("workspace_context_unavailable", "ready");
    } catch {
      return unavailable("workspace_context_unavailable", "ready");
    }
  }

  if (workspaces.length === 0)
    return workspaceRequired(workspaces, "workspace_access_required");
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.slug === selected,
  );
  if (!selectedWorkspace)
    return workspaceRequired(workspaces, "workspace_selection_required");

  return readiness({
    state: "ready",
    reason: null,
    nextAction: null,
    authentication: "ready",
    selected_workspace: selectedWorkspace,
  });
}

export function unavailable(
  reason: ReadinessReason,
  authentication: FonteReadiness["authentication"] = "not_checked",
): FonteReadiness {
  return readiness({
    state: "unavailable",
    reason,
    nextAction: unavailableAction(reason),
    authentication,
  });
}

function unavailableAction(reason: ReadinessReason): string {
  if (reason === "workspace_catalog_unavailable")
    return "Check network access, then run fonte setup again.";
  if (reason === "codex_configuration_unavailable")
    return "Run fonte setup again. If Codex still cannot be configured, contact Fonte support.";
  if (reason === "workspace_context_unavailable")
    return "Run fonte setup again. If the workspace choice still cannot be saved, contact Fonte support.";
  if (reason === "local_sign_in_unavailable")
    return "Run fonte setup again. If the sign-in still cannot be read, contact Fonte support.";
  return "Run fonte setup again. If the problem continues, contact Fonte support.";
}

function workspaceRequired(
  workspaces: readonly ReadinessWorkspace[],
  reason: "workspace_access_required" | "workspace_selection_required",
): FonteReadiness {
  return readiness({
    state: "workspace_required",
    reason,
    nextAction:
      reason === "workspace_access_required"
        ? "Ask a Fonte workspace administrator to grant access, then run fonte setup again."
        : "Choose one listed workspace with fonte setup --workspace <slug> --json.",
    authentication: "ready",
    workspaces,
  });
}

type ReadinessOverrides = Partial<
  Pick<
    FonteReadiness,
    | "state"
    | "reason"
    | "authentication"
    | "selected_workspace"
    | "missing_tools"
  >
> & {
  readonly nextAction?: string | null;
  readonly workspaces?: readonly ReadinessWorkspace[];
};

function readiness(overrides: ReadinessOverrides): FonteReadiness {
  const workspaces = overrides.workspaces ?? [];
  return {
    schema: "fonte.readiness.v1",
    state: overrides.state ?? "unavailable",
    reason: overrides.reason ?? null,
    next_action: overrides.nextAction ?? null,
    cli_version: CLI_VERSION,
    capability_version: MCP_PRODUCT_CAPABILITY_VERSION,
    authentication: overrides.authentication ?? "not_checked",
    selected_workspace: overrides.selected_workspace ?? null,
    workspace_choices: workspaces.slice(0, maxWorkspaceChoices),
    more_workspace_choices: workspaces.length > maxWorkspaceChoices,
    missing_tools: overrides.missing_tools ?? [],
  };
}
