import type {
  PreflightAudienceEvidence,
  PreflightAudienceSource,
  PreflightRecipientExpression,
} from "./operator-preflight-types.js";

export interface AudienceReuseOverrideInput {
  readonly version: "audience_reuse_override.v1";
  readonly audienceIdentity: string;
  readonly acknowledged: true;
}

export type RecipientReferenceInput =
  | { readonly kind: "collection"; readonly collectionId: string }
  | { readonly kind: "import_batch"; readonly contactImportBatchId: string };

export interface RecipientExpressionInput {
  readonly include: readonly RecipientReferenceInput[];
  readonly exclude: readonly RecipientReferenceInput[];
}

export type ProductionAudienceInput =
  | { readonly kind: "all_contacts"; readonly expression: null }
  | {
      readonly kind: "recipient_expression";
      readonly expression: RecipientExpressionInput;
    };

export interface ProductionDraftCreateInput {
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

export interface ProductionDraftReadInput {
  readonly workspace: string;
  readonly draftId: string;
}

export interface ProductionAudiencePreviewInput extends ProductionDraftReadInput {}

export interface ProductionTestSendInput extends ProductionDraftReadInput {
  readonly revision: number;
  readonly postalAddress: string;
  readonly idempotencyKey: string;
}

export interface ProductionTestReadInput extends ProductionDraftReadInput {
  readonly testId: string;
}

export interface ProductionAuthorizeInput extends ProductionDraftReadInput {
  readonly revision: number;
  readonly postalAddress: string;
  readonly idempotencyKey: string;
  readonly audienceReuseOverride: AudienceReuseOverrideInput | null;
}

export interface ProductionBroadcastReadInput {
  readonly workspace: string;
  readonly broadcastId: string;
}

export interface ProductionBroadcastControlInput extends ProductionBroadcastReadInput {
  readonly operation: "pause" | "resume" | "cancel_remaining";
}

export interface ProductionBroadcastReleaseInput extends ProductionBroadcastReadInput {
  readonly idempotencyKey: string;
  readonly maximumRecipientCount: number;
}

export interface ProductionAudienceAppendInput extends ProductionBroadcastReadInput {
  readonly frozenAudienceId: string;
  readonly identitySetSha256: string;
  readonly acceptedTargetCeiling: number;
  readonly appendAuthorizationId: string;
  readonly idempotencyKey: string;
}

export interface ProductionAudienceAppendBaselineResult {
  readonly authorization_id: string;
  readonly recipient_snapshot_id: string;
  readonly send_plan_decision_id: string;
  readonly draft_version: number;
  readonly sender_id: string;
  readonly render_content_digest: string;
  readonly communication_purpose_id: string;
  readonly original_recipient_count: number;
  readonly current_snapshot_count: number;
  readonly current_released_recipient_count: number;
  readonly current_accepted_recipient_count: number;
  readonly current_billing_reserved_recipient_count: number;
  readonly control_state: "active" | "paused";
}

export interface ProductionAudienceAppendPreflightResult {
  readonly tenant_id: string;
  readonly baseline: ProductionAudienceAppendBaselineResult;
  readonly readback: ProductionAudienceAppendReadbackResult;
}

export interface ProductionAudienceAppendReadbackResult {
  readonly broadcast_id: string;
  readonly authorization_id: string;
  readonly aggregate: {
    readonly requested_recipient_count: number;
    readonly eligible_recipient_count: number;
    readonly released_recipient_count: number;
    readonly accepted_recipient_count: number;
    readonly held_recipient_count: number;
    readonly control_state: "active" | "paused" | "cancelled";
  };
  readonly segments: readonly {
    readonly segment: "original" | "append";
    readonly append_authorization_id: string | null;
    readonly frozen_audience_id: string | null;
    readonly canonical_identity_set_sha256: string | null;
    readonly recipient_index_start: number;
    readonly source_recipient_count: number;
    readonly prior_segment_recipient_count: number;
    readonly excluded_recipient_count: number;
    readonly protected_recipient_count: number;
    readonly unknown_recipient_count: number;
    readonly eligible_recipient_count: number;
    readonly accepted_target_ceiling: number | null;
    readonly released_recipient_count: number;
    readonly held_recipient_count: number;
    readonly accepted_recipient_count: number;
    readonly refused_recipient_count: number;
    readonly indeterminate_recipient_count: number;
    readonly cancelled_recipient_count: number;
    readonly delivered_recipient_count: number;
    readonly complained_recipient_count: number;
    readonly accepted_email_usage_quantity: number;
    readonly created_at: string;
  }[];
}

export interface ProductionAudienceAppendResult {
  readonly kind: "broadcast_audience_append";
  readonly broadcast_id: string;
  readonly append_authorization_id: string;
  readonly accepted_target_ceiling: number;
  readonly idempotency_key: string;
  readonly replayed: boolean;
  readonly baseline: ProductionAudienceAppendBaselineResult;
  readonly aggregate: ProductionAudienceAppendReadbackResult["aggregate"];
  readonly segments: ProductionAudienceAppendReadbackResult["segments"];
}

export interface ProductionDraftResult {
  readonly kind: "broadcast_draft";
  readonly outcome: "applied" | "no_change" | null;
  readonly draft_id: string;
  readonly version: number;
  readonly title: string;
  readonly subject: string;
  readonly body: string;
  readonly preheader: string | null;
  readonly sender_profile_id: string;
  readonly reply_to: string | null;
  readonly communication_purpose_id: string;
  readonly communication_purpose_name: string;
  readonly audience_kind: "all_contacts" | "recipient_expression";
  readonly recipient_expression: PreflightRecipientExpression | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProductionAudienceOptionsResult {
  readonly kind: "broadcast_audience_options";
  readonly communication_purposes: readonly {
    readonly communication_purpose_id: string;
    readonly label: string;
  }[];
  readonly sources: readonly PreflightAudienceSource[];
}

export interface ProductionAudiencePreviewResult extends PreflightAudienceEvidence {
  readonly kind: "broadcast_audience_preview";
  readonly draft_id: string;
  readonly communication_purpose_name: string | null;
}

interface QueuedBroadcastResultBase {
  readonly draft_id: string;
  readonly broadcast_id: string;
  readonly recipient_snapshot_id: string;
  readonly send_plan_decision_id: string;
  readonly replayed: boolean;
  readonly requested_recipient_count: number;
  readonly eligible_recipient_count: number;
  readonly refused_recipient_count: number;
  readonly unknown_recipient_count: number;
}

export type QueuedBroadcastResult = QueuedBroadcastResultBase &
  (
    | {
        readonly kind: "broadcast_test_queued";
        readonly audience_targeting: null;
      }
    | {
        readonly kind: "broadcast_authorization";
        readonly audience_targeting: FrozenAudienceTargetingResult;
      }
  );

export interface ProductionTestResult {
  readonly kind: "production_test";
  readonly draft_id: string;
  readonly test_id: string;
  readonly status: "processing" | "unknown" | "terminal";
  readonly poll_after_milliseconds: number | null;
  readonly submitted_count: number;
  readonly accepted_count: number;
  readonly refused_count: number;
  readonly unknown_count: number;
  readonly accepted_email_usage_quantity: number;
}

export interface ProductionBroadcastProgressResult {
  readonly kind: "broadcast_progress";
  readonly broadcast_id: string;
  readonly status: "processing" | "paused" | "cancelled" | "terminal";
  readonly control_state: "active" | "paused" | "cancelled";
  readonly progress_version: string;
  readonly requested_recipient_count: number;
  readonly eligible_recipient_count: number;
  readonly released_recipient_count: number;
  readonly held_recipient_count: number;
  readonly excluded_recipient_count: number;
  readonly pending_recipient_count: number;
  readonly claimed_recipient_count: number;
  readonly accepted_recipient_count: number;
  readonly refused_recipient_count: number;
  readonly unknown_recipient_count: number;
  readonly cancelled_recipient_count: number;
  readonly remaining_recipient_count: number;
  readonly current_rate_per_second: number | null;
  readonly as_of: string;
  readonly estimated_completion_at: string | null;
}

export interface FrozenAudienceTargetingResult {
  readonly communication_purpose_id: string;
  readonly communication_purpose_name: string;
  readonly audience_kind: "all_contacts" | "recipient_expression";
  readonly recipient_expression: PreflightRecipientExpression | null;
  readonly source_provenance: readonly PreflightAudienceSource[];
  readonly counts: {
    readonly matched: number;
    readonly excluded: number;
    readonly ineligible_protected: number;
    readonly unknown: number;
    readonly final_eligible: number;
  };
  readonly reuse_evidence: {
    readonly identity: string;
    readonly prior_authorization_count: number;
    readonly latest_authorized_at: string | null;
    readonly override_acknowledged: boolean;
  } | null;
}

export interface ProductionBroadcastResult {
  readonly kind: "broadcast_result";
  readonly draft_id: string;
  readonly broadcast_id: string;
  readonly status: "processing" | "paused" | "cancelled" | "terminal";
  readonly requested_recipient_count: number;
  readonly eligible_recipient_count: number;
  readonly accepted_recipient_count: number;
  readonly refused_recipient_count: number;
  readonly unknown_recipient_count: number;
  readonly pending_recipient_count: number;
  readonly claimed_recipient_count: number;
  readonly cancelled_recipient_count: number;
  readonly delivered_count: number;
  readonly accepted_email_usage_quantity: number;
  readonly billable_accepted_email_quantity: number | null;
  readonly unit_price_micros: number | null;
  readonly accrued_amount_micros: number | null;
  readonly currency: string | null;
  readonly audience_targeting: FrozenAudienceTargetingResult | null;
}
