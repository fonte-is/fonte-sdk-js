export type BroadcastPreflightStatus =
  "ready" | "blocked" | "stale" | "unavailable";

export interface BroadcastPreflightCheck<T> {
  readonly status: BroadcastPreflightStatus;
  readonly reason_code: string | null;
  readonly evidence: T | null;
}

export interface BroadcastPreflightBlocker {
  readonly authority: string;
  readonly code: string;
}

export type PreflightRecipientReference =
  | { readonly kind: "collection"; readonly collection_id: string }
  | { readonly kind: "import_batch"; readonly contact_import_batch_id: string };

export interface PreflightRecipientExpression {
  readonly include: readonly PreflightRecipientReference[];
  readonly exclude: readonly PreflightRecipientReference[];
}

export type PreflightAudienceSource =
  | {
      readonly kind: "collection";
      readonly collection_id: string;
      readonly collection_kind: "list" | "segment" | "tag";
      readonly label: string;
      readonly source_connection_id: string | null;
      readonly external_collection_id: string | null;
      readonly created_at: string;
    }
  | {
      readonly kind: "import_batch";
      readonly contact_import_batch_id: string;
      readonly label: string | null;
      readonly imported_contact_count: number;
      readonly created_at: string;
    };

export interface PreflightAudienceEvidence {
  readonly communication_purpose_id: string | null;
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
}

export interface BroadcastPreflightResult {
  readonly kind: "broadcast_preflight";
  readonly schema_version: "broadcast_preflight.v1";
  readonly workspace_id: string;
  readonly workspace_slug: string;
  readonly environment: "sandbox" | "production";
  readonly broadcast_draft_id: string;
  readonly requested_draft_version: number;
  readonly confirmed_draft_version: number | null;
  readonly observed_at: string;
  readonly ready: boolean;
  readonly blockers: readonly BroadcastPreflightBlocker[];
  readonly checks: {
    readonly draft: BroadcastPreflightCheck<{
      readonly updated_at: string;
      readonly version: number;
    }>;
    readonly rendering: BroadcastPreflightCheck<never>;
    readonly authorization: BroadcastPreflightCheck<{
      readonly render_content_digest: string;
      readonly sender_id: string;
    }>;
    readonly sender: BroadcastPreflightCheck<{
      readonly sender_id: string;
    }>;
    readonly audience: BroadcastPreflightCheck<PreflightAudienceEvidence>;
    readonly audience_reuse: BroadcastPreflightCheck<{
      readonly identity: {
        readonly version: "audience_reuse_identity.v1";
        readonly digest: string;
      };
      readonly prior_authorization_count: number | null;
      readonly latest_authorized_at: string | null;
      readonly override_required: boolean | null;
      readonly override_accepted: boolean;
    }>;
    readonly billing: BroadcastPreflightCheck<{
      readonly billing_required: boolean;
      readonly eligible_recipient_count: number;
      readonly reason_code: string | null;
    }>;
    readonly safety_feedback: BroadcastPreflightCheck<{
      readonly observed_at: string;
    }>;
    readonly provider_capacity: BroadcastPreflightCheck<{
      readonly region: string;
      readonly observed_at: string;
      readonly max_24_hour_send: number;
      readonly effective_sent_last_24_hours: number;
      readonly daily_remaining: number;
      readonly max_send_rate: number;
      readonly operating_sends_per_second: number;
      readonly provider_health: "healthy" | "degraded";
    }>;
  };
}
