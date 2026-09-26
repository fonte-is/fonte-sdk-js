export interface BroadcastRenderProof {
  readonly source: "composer" | "html";
  readonly template_identity: "workspace_broadcast_v1" | "complete_html_v1";
  readonly template_revision: string;
  readonly broadcast_version: number;
  readonly renderer_version: string;
  readonly recipient_slot_schema_version: string;
  readonly finalizer_version: string;
  readonly text_source: "draft";
  readonly render_hash: string;
}

export interface BroadcastSampleRender {
  readonly recipient_email: string;
  readonly unsubscribe_url: string;
  readonly postal_address: string | null;
  readonly finalizer_version: string;
  readonly html: string;
  readonly text: string;
}

export interface BroadcastDraftRenderInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly revision: number;
}

export interface BroadcastDraftRenderResult {
  readonly kind: "broadcast_draft_render";
  readonly draft_id: string;
  readonly revision: number;
  readonly sender_profile_id: string;
  readonly render_content_digest: string;
  readonly subject: string;
  readonly reply_to: string | null;
  readonly preheader: string | null;
  readonly postal_address: string | null;
  readonly click_tracking_enabled: boolean;
  readonly html: string;
  readonly text: string;
  readonly render_proof: BroadcastRenderProof;
  readonly sample_render: BroadcastSampleRender;
}

export interface BroadcastTestRequestInput extends BroadcastDraftRenderInput {
  readonly operationId: string;
  readonly renderProof: BroadcastRenderProof;
}

export interface BroadcastTestRequestResult {
  readonly kind: "broadcast_test_request";
  readonly draft_id: string;
  readonly test_id: string;
  readonly revision: number;
  readonly operation_id: string;
  readonly replayed: boolean;
  readonly render_proof: BroadcastRenderProof;
}

export interface BroadcastTestReadInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly testId: string;
}

export interface BroadcastTestFeedback {
  readonly recipient_result_count: number;
  readonly provider_accepted_count: number;
  readonly delivered_count: number;
  readonly delivery_delayed_count: number;
  readonly bounced_count: number;
  readonly complained_count: number;
  readonly rejected_count: number;
  readonly rendering_failed_count: number;
}

export interface BroadcastTestResult {
  readonly kind: "broadcast_test_result";
  readonly draft_id: string;
  readonly test_id: string;
  readonly revision: number;
  readonly status: "processing" | "unknown" | "terminal";
  readonly poll_after_milliseconds: number | null;
  readonly feedback_observations_may_change: boolean;
  readonly accepted_count: number;
  readonly refused_count: number;
  readonly unknown_count: number;
  readonly provider_submission_status:
    | "processing"
    | "accepted"
    | "partially_accepted"
    | "refused"
    | "unknown"
    | "not_submitted";
  readonly provider_outcome: "accepted" | "refused" | "unknown";
  readonly delivery_outcome: "delivered" | "not_delivered" | "unknown";
  readonly inbox_confirmation: "unavailable";
  readonly provider_message_id: string | null;
  readonly feedback: BroadcastTestFeedback;
  readonly version_unchanged_since_test: boolean;
  readonly render_proof: BroadcastRenderProof;
}
