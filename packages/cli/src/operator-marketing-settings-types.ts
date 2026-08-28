export interface WorkspaceMarketingSettingsOperatorCommand {
  readonly kind: "workspace_marketing_settings_read";
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
}

export interface WorkspaceMarketingSettingsInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
}

export interface WorkspaceMarketingSettingsResult {
  readonly kind: "workspace_marketing_settings";
  readonly workspaceId: string;
  readonly environment: "sandbox" | "production";
  readonly postalAddress: string;
  readonly updatedAt: string;
}
