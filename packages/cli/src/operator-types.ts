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
  SandboxTestResult | ResendBridgePreviewResult | ResendBridgeCopyResult;

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
      | "fonte.core.resend_bridge.v1"
      | "unavailable";
  };
  readonly core_effect: "none" | "queued" | "copied" | "unknown";
  readonly result: OperatorResult | null;
}
