import { CliUsageError } from "./errors.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

export function parseWorkspaceMarketingSettingsArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (
    argv[0] !== "broadcast" ||
    argv[1] !== "marketing-settings" ||
    argv[2] !== "read"
  ) {
    return null;
  }
  const values = new Map<string, string>();
  let json = false;
  for (let index = 3; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--json" && !json) {
      json = true;
      continue;
    }
    if (
      (name !== "--workspace" && name !== "--environment") ||
      values.has(name)
    ) {
      invalid();
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || value.includes("\0")) invalid();
    values.set(name, value);
    index += 1;
  }
  const workspace = values.get("--workspace");
  const environment = values.get("--environment");
  if (
    !workspace ||
    workspace.length < 2 ||
    workspace.length > 63 ||
    workspace.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(workspace) ||
    (environment !== "sandbox" && environment !== "production")
  ) {
    invalid();
  }
  return {
    command: {
      kind: "workspace_marketing_settings_read",
      workspace,
      environment,
    },
    json,
  };
}

function invalid(): never {
  throw new CliUsageError("invalid_operator_arguments");
}
