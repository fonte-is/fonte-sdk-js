export type BroadcastSendTiming =
  | { readonly mode: "now" }
  | { readonly mode: "scheduled"; readonly not_before: string };

export type BroadcastSendOperationPhase =
  | "scheduled"
  | "queued"
  | "preparing"
  | "authorizing"
  | "packaging"
  | "activation_pending"
  | "sending"
  | "waiting"
  | "action_required"
  | "stopping"
  | "paused"
  | "under_review"
  | "canceling"
  | "canceled"
  | "complete"
  | "failed";

export type BroadcastSendAllowedAction =
  | "cancel"
  | "replace_schedule"
  | "amend_approval"
  | "pause"
  | "resume"
  | "increase_spend_limit"
  | "open_required_action";

export interface BroadcastSpendLimitRequiredAction {
  readonly kind: "increase_account_spend_limit";
  readonly billing_account_id: string;
  readonly currency: "USD";
  readonly current_maximum_minor: number | null;
  readonly minimum_maximum_minor: number;
}

export type BroadcastSendDelivery =
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly observed_at: string | null;
    }
  | {
      readonly status: "available";
      readonly coverage: "complete" | "partial";
      readonly observed_at: string;
      readonly counts: {
        readonly provider_accepted: number | null;
        readonly definitively_not_accepted: number | null;
        readonly unresolved: number | null;
      };
    };

export interface BroadcastSendOperation {
  readonly schema: "broadcast_send_operation.v2";
  readonly operation_id: string;
  readonly workspace_id: string;
  readonly environment: "production";
  readonly draft_id: string;
  readonly instruction_generation: number;
  readonly approval_generation: number;
  readonly accepted_at: string;
  readonly timing: BroadcastSendTiming;
  readonly not_before: string;
  readonly phase: BroadcastSendOperationPhase;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly next_attempt_at: string | null;
  readonly total: number | null;
  readonly timestamps: {
    readonly preparation_started_at: string | null;
    readonly snapshot_at: string | null;
    readonly authorization_committed_at: string | null;
    readonly first_submission_at: string | null;
    readonly terminal_at: string | null;
  };
  readonly delivery: BroadcastSendDelivery;
  readonly required_action: BroadcastSpendLimitRequiredAction | null;
  readonly allowed_actions: readonly BroadcastSendAllowedAction[];
  readonly execution_authorized: false;
  readonly replayed: boolean;
}

export type BroadcastSendOperationResult =
  | {
      readonly kind: "broadcast_send_operation";
      readonly status: "accepted";
      readonly operation: BroadcastSendOperation;
    }
  | {
      readonly kind: "broadcast_send_operation";
      readonly status: "absent";
      readonly operation: null;
    };

interface BroadcastSendScopeInput {
  readonly workspace: string;
  readonly draftId: string;
}

export interface AcceptBroadcastSendInput extends BroadcastSendScopeInput {
  readonly requestId: string;
  readonly expectedDraftVersion: number;
  readonly timing:
    | { readonly mode: "now" }
    | { readonly mode: "scheduled"; readonly notBefore: string };
}

export interface ReadBroadcastSendOperationInput extends BroadcastSendScopeInput {}

export interface ReplaceBroadcastSendScheduleInput extends BroadcastSendScopeInput {
  readonly requestId: string;
  readonly expectedInstructionGeneration: number;
  readonly expectedDraftVersion: number;
  readonly notBefore: string;
}

export interface CancelBroadcastSendInput extends BroadcastSendScopeInput {
  readonly requestId: string;
  readonly expectedInstructionGeneration: number;
}

export interface AmendBroadcastSendApprovalInput extends BroadcastSendScopeInput {
  readonly requestId: string;
  readonly expectedInstructionGeneration: number;
  readonly expectedApprovalGeneration: number;
}

export interface ResolveBroadcastSpendLimitInput extends AmendBroadcastSendApprovalInput {}

export type BroadcastSendInstructionOperatorCommand =
  | ({ readonly kind: "broadcast_send_now" } & Omit<
      AcceptBroadcastSendInput,
      "timing"
    >)
  | ({ readonly kind: "broadcast_schedule"; readonly notBefore: string } & Omit<
      AcceptBroadcastSendInput,
      "timing"
    >)
  | ({
      readonly kind: "broadcast_send_status";
      readonly watch: boolean;
    } & ReadBroadcastSendOperationInput)
  | ({
      readonly kind: "broadcast_schedule_replace";
    } & ReplaceBroadcastSendScheduleInput)
  | ({ readonly kind: "broadcast_send_cancel" } & CancelBroadcastSendInput)
  | ({
      readonly kind: "broadcast_spend_limit_increase";
    } & ResolveBroadcastSpendLimitInput);
