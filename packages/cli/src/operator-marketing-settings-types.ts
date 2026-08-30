export interface WorkspaceMarketingSettingsOperatorCommand {
  readonly kind: "workspace_marketing_settings_read";
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
}

export interface WorkspaceMarketingSettingsInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
}

interface WorkspaceMarketingSettingsResultBase {
  readonly kind: "workspace_marketing_settings";
  readonly workspaceId: string;
  readonly environment: "sandbox" | "production";
}

export type WorkspaceMarketingSettingsResult =
  | (WorkspaceMarketingSettingsResultBase & {
      readonly postalAddress: string;
      readonly updatedAt: string;
    })
  | (WorkspaceMarketingSettingsResultBase & {
      readonly postalAddress: null;
      readonly updatedAt: null;
    });
