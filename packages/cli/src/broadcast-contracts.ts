/** Wire projection of FON-807 break-glass-contracts.ts, fixed BG-1 sections 4/12.
 * Digests are opaque producer commitments, never client execution authority. */
export type BroadcastEnvironment = "sandbox" | "production";
export interface BroadcastScope {
  readonly workspace: string;
  readonly environment: BroadcastEnvironment;
  readonly draftId: string;
}
export interface ResolvedBroadcastScope extends BroadcastScope {
  readonly workspaceId: string;
}
export interface BroadcastReviewRequest {
  readonly schema: "broadcast_review_request.v1";
  readonly requestId: string;
  readonly expectedDraftVersion: number;
  readonly audienceMode: "reuse_compatible" | "refresh";
}
export interface BroadcastSendRequest {
  readonly schema: "broadcast_send_request.v2";
  readonly requestId: string;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly expectedDraftVersion: number;
  readonly timing: { readonly mode: "now" };
  readonly resume?: {
    readonly operationId: string;
    readonly expectedOperationVersion: number;
  };
}
export interface BroadcastReview {
  readonly workspaceId: string;
  readonly environment: BroadcastEnvironment;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly createdAt: string;
  readonly audienceRef: {
    readonly schema: "broadcast_audience.v1";
    readonly audienceId: string;
    readonly digest: string;
    readonly recipientCount: number;
    readonly selectionDigest: string;
    readonly purposeRef: string;
  };
  readonly messageRef: { readonly id: string; readonly digest: string };
  readonly commercialReviewRef: {
    readonly id: string;
    readonly digest: string;
  };
  readonly routeRef: {
    readonly schema: "broadcast_sender_route.v1";
    readonly routeId: string;
    readonly digest: string;
    readonly workspaceId: string;
    readonly environment: BroadcastEnvironment;
    readonly provider: "ses_v2";
    readonly accountId: string;
    readonly region: string;
    readonly senderIdentity: string;
    readonly authorizedFrom: string;
    readonly tenantId: string;
    readonly configurationSet: string;
    readonly feedbackDestination: string;
    readonly setupSource: string;
    readonly setupRevision: string;
  };
}
export interface BroadcastBlocker {
  readonly code:
    | "draft_changed"
    | "request_conflict"
    | "request_superseded"
    | "broadcast_audience_empty"
    | "sender_route_unavailable"
    | "commercial_action_required"
    | "access_revoked"
    | "execution_state_conflict";
  readonly stage?: string;
  readonly reason?: string;
}
export interface BroadcastOperation {
  readonly operationId: string;
  readonly operationVersion: number;
  readonly draftId: string;
  readonly reviewId: string | null;
  readonly operationUri: string;
  readonly observedAt: string;
  readonly blocker?: BroadcastBlocker;
}
export type BroadcastReviewReceipt = BroadcastOperation & {
  readonly executionAuthorized: false;
} & (
    | {
        readonly state: "ready";
        readonly review: BroadcastReview;
        readonly summary: {
          readonly recipientCount: number;
          readonly excludedCount: number;
        };
      }
    | {
        readonly state: "queued" | "running" | "failed" | "cancelled";
        readonly review: null;
        readonly summary: null;
      }
  );
export type BroadcastSendReceipt = BroadcastOperation &
  (
    | {
        readonly outcome: "executable";
        readonly executionAuthorized: true;
        readonly jobId: string;
      }
    | {
        readonly outcome: "processing" | "action_required" | "rejected";
        readonly executionAuthorized: false;
        readonly jobId: null;
      }
  );
export interface BroadcastExecutionProgress {
  readonly state: "sending" | "paused" | "ended" | "completed";
  readonly stateVersion: number;
  readonly stateReason: string | null;
  readonly observedAt: string;
  readonly recipientCount: number;
  readonly pending: number;
  readonly inFlight: number;
  readonly accepted: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unknown: number;
  readonly notSentEnded: number;
  readonly delivered: number;
  readonly attemptCount: number;
  readonly coverage: "complete" | "partial" | "unavailable";
}
export type BroadcastSendStatus = BroadcastSendReceipt & {
  readonly execution: BroadcastExecutionProgress | null;
};
export type BroadcastReceipt =
  BroadcastReviewReceipt | BroadcastSendReceipt | BroadcastSendStatus;
export interface SavedBroadcastRequest extends ResolvedBroadcastScope {
  readonly schema: "fonte_broadcast_request.v1";
  readonly coreOrigin: string;
  readonly request: BroadcastReviewRequest | BroadcastSendRequest;
}
export interface BroadcastRequestStore {
  /** Must durably create before POST, reject any changed same-key input, and never replace input. */
  persist(input: SavedBroadcastRequest): Promise<SavedBroadcastRequest>;
  read(requestId: string): Promise<SavedBroadcastRequest>;
  readSuperseded(requestId: string): Promise<BroadcastSendReceipt | null>;
  rememberSuperseded(
    requestId: string,
    receipt: BroadcastSendReceipt,
  ): Promise<void>;
}
