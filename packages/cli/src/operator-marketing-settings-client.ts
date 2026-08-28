import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { workspaceMarketingSettings } from "./operator-marketing-settings-json.js";
import type {
  WorkspaceMarketingSettingsInput,
  WorkspaceMarketingSettingsResult,
} from "./operator-marketing-settings-types.js";

export interface WorkspaceMarketingSettingsClient {
  readWorkspaceMarketingSettings(
    input: WorkspaceMarketingSettingsInput,
  ): Promise<WorkspaceMarketingSettingsResult>;
}

export function createWorkspaceMarketingSettingsClient(
  request: CoreRequester,
): WorkspaceMarketingSettingsClient {
  return {
    async readWorkspaceMarketingSettings(input) {
      const workspace = workspaceSlug(input.workspace);
      if (
        input.environment !== "sandbox" &&
        input.environment !== "production"
      ) {
        invalidRequest();
      }
      const result = parseCoreReceipt(
        workspaceMarketingSettings,
        await request(
          `/v1/workspaces/${encodeURIComponent(workspace)}/marketing-settings?environment=${input.environment}`,
        ),
      );
      if (result.environment !== input.environment) invalidReceipt();
      return result;
    },
  };
}

function workspaceSlug(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  ) {
    invalidRequest();
  }
  return value;
}

function invalidRequest(): never {
  throw new CoreOperatorError(
    "workspace_marketing_settings_request_invalid",
    null,
    "none",
  );
}

function invalidReceipt(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
}
