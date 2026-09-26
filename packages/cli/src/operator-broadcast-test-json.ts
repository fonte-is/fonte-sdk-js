import {
  boolean,
  count,
  nullableCount,
  nullableText,
  positiveInteger,
  productionBody,
  providerSubmissionStatus,
  record,
  renderProof,
  testStatus,
  uuid,
} from "./operator-broadcast-render-values.js";
import type {
  BroadcastTestFeedback,
  BroadcastTestRequestResult,
  BroadcastTestResult,
} from "./operator-broadcast-render-test-types.js";

export function broadcastTestRequest(
  value: unknown,
  operationId: string,
): BroadcastTestRequestResult {
  const body = productionBody(value);
  if (
    body.status !== "queued" || body.deliveryKind !== "test"
    || body.billingEffect !== "ordinary_email_usage_authority"
    || count(body.submittedCount) !== 1 || count(body.acceptedCount) !== 1
    || count(body.refusedCount) !== 0 || count(body.unknownCount) !== 0
  ) throw new TypeError("test request receipt invalid");
  const proof = renderProof(body.renderProof);
  return {
    kind: "broadcast_test_request",
    draft_id: uuid(body.broadcastDraftId),
    test_id: uuid(body.marketingBroadcastId),
    revision: proof.broadcast_version,
    operation_id: operationId,
    replayed: !boolean(body.created),
    render_proof: proof,
  };
}

export function broadcastTestResult(value: unknown): BroadcastTestResult {
  const body = productionBody(value);
  if (body.deliveryKind !== "test"
    || body.statusScope !== "provider_submission_and_billing") {
    throw new TypeError("test result scope invalid");
  }
  const status = testStatus(body.status);
  const submitted = count(body.submittedCount);
  const accepted = count(body.acceptedCount);
  const refused = count(body.refusedCount);
  const unknown = count(body.unknownCount);
  const outbox = record(body.outbox);
  const feedback = feedbackResult(body.feedback);
  const providerStatus = providerSubmissionStatus(outbox.providerSubmissionStatus);
  const providerMessageId = nullableText(outbox.providerMessageId);
  const feedbackMayChange = boolean(body.feedbackObservationsMayChange);
  const originalDraft = record(body.originalDraft);
  const proof = renderProof(body.renderProof);
  const testVersion = positiveInteger(originalDraft.testDraftVersion);
  const currentVersion = positiveInteger(originalDraft.currentVersion);
  if (
    submitted !== 1 || accepted + refused + unknown !== submitted
    || feedback.provider_accepted_count !== accepted
    || proof.broadcast_version !== testVersion
    || boolean(originalDraft.versionUnchangedSinceTest)
      !== (testVersion === currentVersion)
    || (accepted === 1 && providerMessageId === null)
    || (accepted === 0 && providerMessageId !== null)
  ) throw new TypeError("test result counts do not reconcile");
  return {
    kind: "broadcast_test_result",
    draft_id: uuid(body.broadcastDraftId),
    test_id: uuid(body.marketingBroadcastId),
    revision: proof.broadcast_version,
    status,
    poll_after_milliseconds: nullableCount(body.pollAfterMilliseconds),
    feedback_observations_may_change: feedbackMayChange,
    accepted_count: accepted,
    refused_count: refused,
    unknown_count: unknown,
    provider_submission_status: providerStatus,
    provider_outcome: accepted === 1
      ? "accepted" : refused === 1 ? "refused" : "unknown",
    delivery_outcome: feedback.delivered_count === 1
      ? "delivered" : feedbackMayChange ? "unknown" : "not_delivered",
    inbox_confirmation: "unavailable",
    provider_message_id: providerMessageId,
    feedback,
    version_unchanged_since_test: boolean(originalDraft.versionUnchangedSinceTest),
    render_proof: proof,
  };
}

function feedbackResult(value: unknown): BroadcastTestFeedback {
  const body = record(value);
  const result = {
    recipient_result_count: count(body.recipientResultCount),
    provider_accepted_count: count(body.providerAcceptedCount),
    delivered_count: count(body.deliveredCount),
    delivery_delayed_count: count(body.deliveryDelayedCount),
    bounced_count: count(body.bouncedCount),
    complained_count: count(body.complainedCount),
    rejected_count: count(body.rejectedCount),
    rendering_failed_count: count(body.renderingFailedCount),
  };
  if (Object.values(result).some((item) => item > 1)) {
    throw new TypeError("verified test feedback count exceeds one");
  }
  return result;
}
