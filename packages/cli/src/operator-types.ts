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

export interface OperatorReceipt {
  readonly schema_version: "fonte.cli.operator_receipt.v1";
  readonly command: OperatorCommand["kind"];
  readonly outcome:
    "queued" | "terminal" | "completed" | "blocked" | "unsupported_authority";
  readonly reason: string;
  readonly workspace: string | null;
  readonly authority: {
    readonly status: "current" | "missing";
    readonly contract_id: "fonte.core.sandbox_canary.v1" | "unavailable";
  };
  readonly core_effect: "none" | "queued" | "unknown";
  readonly result: SandboxTestResult | null;
}
