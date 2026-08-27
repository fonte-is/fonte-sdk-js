import type { BroadcastPreflightResult } from "./operator-preflight-types.js";
import type { OperatorNextAction } from "./operator-broadcast-recovery.js";
import type {
  ContactImportStatusResult,
  ProviderAudienceFreezeResult,
  ProviderAudienceOperatorCommand,
  ProviderAudienceReconciliationResult,
  ProviderCollectionListResult,
} from "./operator-provider-audience-types.js";
import type {
  ProviderConnectionListResult,
  ProviderConnectionOAuthResult,
  ProviderConnectionOperatorCommand,
} from "./operator-provider-connection-types.js";
import type {
  AudienceReuseOverrideInput,
  ProductionAudienceInput,
  ProductionAudienceAppendResult,
  ProductionAudienceOptionsResult,
  ProductionAudiencePreviewResult,
  ProductionBroadcastProgressResult,
  ProductionBroadcastResult,
  ProductionDraftResult,
  ProductionTestResult,
  QueuedBroadcastResult,
} from "./operator-production-types.js";

export type OperatorCommand =
  | {
      readonly kind: "broadcast_test_send";
      readonly workspace: string;
      readonly draftId: string;
      readonly revision: number;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: "broadcast_test_status";
      readonly workspace: string;
      readonly testId: string;
      readonly watch: boolean;
    }
  | {
      readonly kind: "broadcast_preflight";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly draftId: string;
      readonly expectedVersion: number;
      readonly postalAddress: string;
      readonly audienceReuseOverride: AudienceReuseOverrideInput | null;
    }
  | {
      readonly kind: "broadcast_draft_create";
      readonly workspace: string;
      readonly idempotencyKey: string;
      readonly title: string;
      readonly subject: string;
      readonly body: string;
      readonly preheader: string | null;
      readonly senderProfileId: string;
      readonly replyTo: string | null;
      readonly communicationPurposeId: string;
      readonly audience: ProductionAudienceInput;
    }
  | {
      readonly kind: "broadcast_draft_read";
      readonly workspace: string;
      readonly draftId: string;
    }
  | {
      readonly kind: "broadcast_audience_options";
      readonly workspace: string;
    }
  | {
      readonly kind: "broadcast_audience_preview";
      readonly workspace: string;
      readonly draftId: string;
    }
  | {
      readonly kind: "broadcast_production_test_send";
      readonly workspace: string;
      readonly draftId: string;
      readonly revision: number;
      readonly postalAddress: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: "broadcast_production_test_status";
      readonly workspace: string;
      readonly draftId: string;
      readonly testId: string;
      readonly watch: boolean;
    }
  | {
      readonly kind: "broadcast_authorize";
      readonly workspace: string;
      readonly draftId: string;
      readonly revision: number;
      readonly postalAddress: string;
      readonly idempotencyKey: string;
      readonly audienceReuseOverride: AudienceReuseOverrideInput | null;
    }
  | {
      readonly kind: "broadcast_progress";
      readonly workspace: string;
      readonly broadcastId: string;
      readonly watch: boolean;
    }
  | {
      readonly kind: "broadcast_control";
      readonly workspace: string;
      readonly broadcastId: string;
      readonly operation: "pause" | "resume" | "cancel_remaining";
      readonly expectedControlVersion: string;
    }
  | {
      readonly kind: "broadcast_result";
      readonly workspace: string;
      readonly broadcastId: string;
    }
  | {
      readonly kind: "broadcast_canary";
      readonly workspace: string;
      readonly broadcastId: string;
      readonly releaseCeiling: number;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: "broadcast_audience_append";
      readonly workspace: string;
      readonly broadcastId: string;
      readonly frozenAudienceId: string;
      readonly identitySetSha256: string;
      readonly acceptedTargetCeiling: number;
      readonly appendAuthorizationId: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: "bridge_resend_preview";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly segmentId: string;
    }
  | {
      readonly kind: "bridge_resend_copy";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly segmentId: string;
      readonly observationFingerprint: string;
      readonly idempotencyKey: string;
    }
  | ProviderAudienceOperatorCommand
  | ProviderConnectionOperatorCommand
  | { readonly kind: "unsupported" };

export interface ParsedOperatorArguments {
  readonly command: OperatorCommand;
  readonly json: boolean;
}

export interface SandboxTestResult {
  readonly kind: "sandbox_test";
  readonly test_id: string;
  readonly status: "queued" | "processing" | "terminal";
  readonly replayed: boolean | null;
  readonly accepted_count: number | null;
  readonly refused_count: number | null;
  readonly unknown_count: number | null;
  readonly accepted_email_usage_quantity: number | null;
  readonly poll_after_milliseconds: number | null;
}

export interface ResendBridgePreviewResult {
  readonly kind: "resend_bridge_preview";
  readonly provider: "resend";
  readonly connection_id: string;
  readonly segment: { readonly id: string; readonly name: string };
  readonly observed_at: string;
  readonly observation_fingerprint: string;
  readonly pagination: {
    readonly status: "complete" | "partial";
    readonly contacts: ResendBridgeCoverage;
    readonly suppressions: ResendBridgeCoverage;
  };
  readonly contacts_observed: number;
  readonly protected: {
    readonly contacts: number;
    readonly provider_unsubscribed: number;
    readonly provider_suppressed: number;
  };
  readonly unknown: {
    readonly contacts: number;
    readonly property_observations: number;
    readonly suppression_observations: number;
    readonly automation_dependency: "unknown";
  };
}

export interface BroadcastCanaryResult {
  readonly kind: "broadcast_canary";
  readonly operation_id: string;
  readonly broadcast_id: string;
  readonly environment: "production";
  readonly release_ceiling: number;
  readonly authorization: {
    readonly status: "not_granted" | "released";
    readonly started_at: string | null;
    readonly ended_at: string;
    readonly bearer_persisted: false;
  };
  readonly completed_steps: readonly (
    | "authoritative_status"
    | "safe_resume"
    | "guarded_release"
    | "authoritative_wait_read"
    | "safety_pause"
  )[];
  readonly baseline: ProductionBroadcastProgressResult | null;
  readonly final: ProductionBroadcastProgressResult | null;
}

export interface ResendBridgeCoverage {
  readonly status: "complete" | "partial";
  readonly pages_observed: number;
  readonly has_more: boolean;
}

export interface ResendBridgeCopyResult extends Omit<
  ResendBridgePreviewResult,
  "kind"
> {
  readonly kind: "resend_bridge_copy";
  readonly import_receipt: {
    readonly contact_import_batch_id: string;
    readonly created: boolean;
  };
  readonly reconciliation: {
    readonly accepted: number;
    readonly created: number;
    readonly updated: number | null;
    readonly unchanged: number | null;
    readonly protected: number;
    readonly conflict: number | null;
    readonly unknown: number;
  };
}

export type OperatorResult =
  | SandboxTestResult
  | BroadcastCanaryResult
  | ProductionAudienceAppendResult
  | ContactImportStatusResult
  | BroadcastPreflightResult
  | ProductionDraftResult
  | ProductionAudienceOptionsResult
  | ProductionAudiencePreviewResult
  | QueuedBroadcastResult
  | ProductionTestResult
  | ProductionBroadcastProgressResult
  | ProductionBroadcastResult
  | ResendBridgePreviewResult
  | ResendBridgeCopyResult
  | ProviderCollectionListResult
  | ProviderAudienceReconciliationResult
  | ProviderAudienceFreezeResult
  | ProviderConnectionListResult
  | ProviderConnectionOAuthResult;

export interface OperatorReceipt {
  readonly schema_version: "fonte.cli.operator_receipt.v1";
  readonly command: OperatorCommand["kind"];
  readonly outcome:
    "queued" | "terminal" | "completed" | "blocked" | "unsupported_authority";
  readonly reason: string;
  readonly workspace: string | null;
  readonly authority: {
    readonly status: "current" | "missing";
    readonly contract_id:
      | "fonte.core.sandbox_canary.v1"
      | "fonte.core.broadcast_preflight.v1"
      | "fonte.core.production_broadcast.v1"
      | "fonte.core.production_broadcast_audience_append.v1"
      | "fonte.core.resend_bridge.v1"
      | "fonte.core.contact_import.v1"
      | "fonte.core.provider_audience.v1"
      | "fonte.core.provider_connections.v1"
      | "unavailable";
  };
  readonly core_effect:
    | "none"
    | "created"
    | "replaced"
    | "attempted"
    | "queued"
    | "controlled"
    | "copied"
    | "unknown";
  readonly next_action?: OperatorNextAction;
  readonly result: OperatorResult | null;
}
