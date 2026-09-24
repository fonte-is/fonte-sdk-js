import type { FonteReadiness } from "./mcp-readiness.js";

export interface ReadinessRenderOptions {
  readonly setup?: boolean;
  readonly verbose?: boolean;
}

export function renderReadinessHuman(
  readiness: FonteReadiness,
  options: ReadinessRenderOptions = {},
): string {
  const lines: string[] = [];
  const ready = readiness.state === "ready";
  lines.push(
    ready
      ? options.setup
        ? "Fonte setup is complete"
        : "Fonte is ready"
      : options.setup
        ? "Fonte setup needs attention"
        : "Fonte needs attention",
    "",
  );

  if (readiness.selected_workspace) {
    lines.push(`Workspace: ${readiness.selected_workspace.name}`);
  } else if (readiness.state === "workspace_required") {
    lines.push("Workspace: Choose one");
  }
  if (readiness.authentication === "ready") lines.push("Signed in: Yes");
  if (readiness.authentication === "required") lines.push("Signed in: No");

  if (readiness.state === "workspace_required") {
    if (readiness.workspace_choices.length > 0) {
      lines.push("", "Workspaces:");
      for (const workspace of readiness.workspace_choices) {
        lines.push(`- ${workspace.name} (slug: ${workspace.slug})`);
      }
    }
  }

  const action = readinessAction(readiness);
  if (action) {
    lines.push("", "Fix:", `  ${action.fix}`);
    if (action.command) lines.push("", "Run:", `  ${action.command}`);
  }

  if (options.verbose) appendDiagnostics(lines, readiness);
  return `${lines.join("\n")}\n`;
}

function readinessAction(
  readiness: FonteReadiness,
): { readonly fix: string; readonly command?: string } | null {
  if (readiness.state === "ready") return null;
  if (readiness.state === "login_required")
    return { fix: "Sign in to Fonte", command: "fonte auth login" };
  if (readiness.state === "workspace_required") {
    if (readiness.workspace_choices.length > 0)
      return {
        fix: "Choose the workspace Fonte should use",
        command: "fonte setup --workspace <slug>",
      };
    return { fix: "Ask a Fonte workspace administrator for access" };
  }
  if (readiness.state === "repair_required")
    return { fix: "Update Fonte CLI to restore its local tools" };

  switch (readiness.reason) {
    case "codex_configuration_unavailable":
    case "mcp_host_unavailable":
      return { fix: "Configure Fonte on this device", command: "fonte setup" };
    case "local_sign_in_unavailable":
      return {
        fix: "Check your saved sign-in",
        command: "fonte auth status --verbose",
      };
    case "workspace_catalog_unavailable":
      return {
        fix: "Check your internet connection",
        command: "fonte status",
      };
    case "workspace_context_unavailable":
    case "workspace_access_required":
    case "workspace_selection_required":
      return {
        fix: "Configure the workspace Fonte should use",
        command: "fonte setup",
      };
    case "required_tools_missing":
    case "sign_in_required":
      return { fix: "Configure Fonte on this device", command: "fonte setup" };
    default:
      return { fix: "Run Fonte setup again", command: "fonte setup" };
  }
}

function appendDiagnostics(lines: string[], readiness: FonteReadiness): void {
  lines.push("", "Diagnostics:", `Readiness state: ${readiness.state}`);
  if (readiness.reason) lines.push(`Reason code: ${readiness.reason}`);
  lines.push(`Authentication check: ${readiness.authentication}`);
  if (readiness.selected_workspace)
    lines.push(`Workspace slug: ${readiness.selected_workspace.slug}`);
  if (readiness.missing_tools.length > 0) {
    lines.push("Missing local tools:");
    for (const tool of readiness.missing_tools) lines.push(`- ${tool}`);
  }
  lines.push(
    `CLI version: ${readiness.cli_version}`,
    `Tool catalog version: ${readiness.capability_version}`,
  );
}
