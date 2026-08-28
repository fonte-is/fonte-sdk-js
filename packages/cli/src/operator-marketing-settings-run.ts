import type { CoreOperatorClient } from "./operator-client.js";
import type {
  WorkspaceMarketingSettingsOperatorCommand,
  WorkspaceMarketingSettingsResult,
} from "./operator-marketing-settings-types.js";
import type { OperatorCommand, OperatorResult } from "./operator-types.js";

export function executeWorkspaceMarketingSettingsCommand(
  command: OperatorCommand,
  client: CoreOperatorClient,
): Promise<WorkspaceMarketingSettingsResult> | null {
  if (command.kind !== "workspace_marketing_settings_read") return null;
  return client.readWorkspaceMarketingSettings({
    workspace: command.workspace,
    environment: command.environment,
  });
}

export function workspaceMarketingSettingsReceiptDescriptor(
  command: OperatorCommand,
  result: OperatorResult,
): {
  readonly command: WorkspaceMarketingSettingsOperatorCommand;
  readonly result: WorkspaceMarketingSettingsResult;
} | null {
  if (
    command.kind !== "workspace_marketing_settings_read" ||
    result.kind !== "workspace_marketing_settings"
  ) {
    return null;
  }
  return { command, result };
}
