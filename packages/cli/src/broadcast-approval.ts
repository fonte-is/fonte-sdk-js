import type {
  BroadcastReviewReceipt,
  BroadcastScope,
  BroadcastSendRequest,
  SavedBroadcastRequest,
} from "./broadcast-contracts.js";
import {
  CoreOperatorError,
  validateCoreRequestUrl,
} from "./operator-core-request.js";
import { parseBroadcastReviewReceipt } from "./broadcast-receipts.js";
import {
  parseBroadcastSendRequest,
  parseSavedBroadcastRequest,
} from "./broadcast-validation.js";

/** Called only after the user approves this exact ready review. No UUID is generated here.
 * Re-approval explicitly supplies the existing operation's current CAS version. */
export function approvedBroadcastSendRequest(
  review: BroadcastReviewReceipt,
  requestId: string,
  resume?: BroadcastSendRequest["resume"],
): BroadcastSendRequest {
  if (review.state !== "ready")
    throw new CoreOperatorError("broadcast_review_required", null, "none");
  if (review.summary.recipientCount === 0)
    throw new CoreOperatorError("broadcast_audience_empty", null, "none");
  return parseBroadcastSendRequest({
    schema: "broadcast_send_request.v2",
    requestId,
    reviewId: review.review.reviewId,
    reviewDigest: review.review.reviewDigest,
    expectedDraftVersion: review.review.draftVersion,
    timing: { mode: "now" },
    ...(resume ? { resume } : {}),
  });
}
export function approvedBroadcastSendInput(
  scope: BroadcastScope,
  coreApiBaseUrl: string,
  receipt: BroadcastReviewReceipt,
  requestId: string,
  resume?: BroadcastSendRequest["resume"],
): SavedBroadcastRequest {
  const coreOrigin = new URL(validateCoreRequestUrl("/", coreApiBaseUrl))
    .origin;
  const review = parseBroadcastReviewReceipt(receipt, coreOrigin);
  if (review.state !== "ready")
    throw new CoreOperatorError("broadcast_review_required", null, "none");
  if (
    review.draftId !== scope.draftId ||
    review.review.environment !== scope.environment
  )
    throw new CoreOperatorError(
      "broadcast_saved_input_scope_conflict",
      null,
      "none",
    );
  return parseSavedBroadcastRequest({
    ...scope,
    workspaceId: review.review.workspaceId,
    schema: "fonte_broadcast_request.v1",
    coreOrigin,
    request: approvedBroadcastSendRequest(review, requestId, resume),
  });
}
