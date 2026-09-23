export type CampaignEnvironment = "sandbox" | "production";

export interface CampaignScopeInput {
  readonly workspace: string;
  readonly environment: CampaignEnvironment;
}

export interface CampaignListInput extends CampaignScopeInput {
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeArchived?: boolean;
}

export interface CampaignReadInput extends CampaignScopeInput {
  readonly campaignId: string;
}

export interface CampaignCreateInput extends CampaignScopeInput {
  readonly campaignId: string;
  readonly operationId: string;
  readonly title: string;
  readonly description?: string;
}

export interface CampaignUpdateInput extends CampaignReadInput {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly title: string;
  readonly description: string;
  readonly archived: boolean;
}

export interface CampaignCommandReceiptInput extends CampaignScopeInput {
  readonly operationId: string;
}

export interface CampaignConfigurationWire {
  readonly workspaceId: string;
  readonly environment: CampaignEnvironment;
  readonly campaignId: string;
  readonly revision: number;
  readonly title: string;
  readonly description: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scopeBindingStatus: "not_qualified";
}

export interface CampaignWireReceipt {
  readonly operationId: string;
  readonly commandKind: "create" | "update";
  readonly campaignId: string;
  readonly resultingRevision: number;
  readonly committedAt: string;
}

export interface CampaignListEnvelope {
  readonly schemaVersion: "campaign_configuration.v1";
  readonly tenantId: string;
  readonly environment: CampaignEnvironment;
  readonly configurations: readonly CampaignConfigurationWire[];
  readonly nextCursor: string | null;
}

export interface CampaignReadEnvelope {
  readonly schemaVersion: "campaign_configuration.v1";
  readonly tenantId: string;
  readonly environment: CampaignEnvironment;
  readonly configuration: CampaignConfigurationWire;
}

export interface CampaignCommandEnvelope {
  readonly schemaVersion: "campaign_configuration.v1";
  readonly tenantId: string;
  readonly environment: CampaignEnvironment;
  readonly configuration: CampaignConfigurationWire;
  readonly receipt: CampaignWireReceipt;
  readonly replayed: boolean;
}

export type CampaignMetadataEnvelope =
  CampaignListEnvelope | CampaignReadEnvelope | CampaignCommandEnvelope;

export type CampaignOperatorCommand =
  | ({ readonly kind: "campaign_list" } & CampaignListInput)
  | ({ readonly kind: "campaign_read" } & CampaignReadInput)
  | ({ readonly kind: "campaign_create" } & CampaignCreateInput)
  | ({ readonly kind: "campaign_update" } & CampaignUpdateInput)
  | ({ readonly kind: "campaign_receipt" } & CampaignCommandReceiptInput);

export interface CampaignOperatorReceipt {
  readonly schema_version: "fonte.cli.operator_receipt.v1";
  readonly command: CampaignOperatorCommand["kind"];
  readonly outcome: "completed" | "blocked";
  readonly reason: string;
  readonly workspace: string;
  readonly authority: {
    readonly status: "current";
    readonly contract_id: "fonte.core.campaign_configuration.v1";
  };
  readonly core_effect: "none" | "created" | "replaced" | "unknown";
  readonly next_action?: {
    readonly kind: "read_campaign_command";
    readonly workspace: string;
    readonly environment: CampaignEnvironment;
    readonly operation_id: string;
    readonly resource_id: string;
  };
  readonly result: CampaignMetadataEnvelope | null;
}
