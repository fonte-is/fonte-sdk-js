import {
  boolean,
  controlStateValue,
  count,
  instant,
  invalid,
  nullableCount,
  nullableInstant,
  nullableNumber,
  object,
  progressStatus,
  requireProduction,
  testStatus,
  text,
  uuid,
} from "./operator-production-json-values.js";
import { frozenAudienceTargeting } from "./operator-production-result-json.js";
import type {
  ProductionBroadcastProgressResult,
  ProductionTestResult,
  QueuedBroadcastResult,
} from "./operator-production-types.js";

export function queuedBroadcast(
  value: unknown,
  kind: QueuedBroadcastResult["kind"],
): QueuedBroadcastResult {
  const body = object(value);
  requireProduction(body);
  if (body.status !== "queued") invalid();
  const requested = count(body.submittedCount);
  const eligible = count(body.acceptedCount);
  const refused = count(body.refusedCount);
  const unknown = count(body.unknownCount);
  if (requested !== eligible + refused + unknown) invalid();
  const targeting =
    body.audienceTargeting === undefined
      ? null
      : frozenAudienceTargeting(body.audienceTargeting);
  if ((kind === "broadcast_authorization") !== (targeting !== null)) invalid();
  if (
    targeting &&
    (targeting.counts.matched !== requested ||
      targeting.counts.final_eligible !== eligible)
  )
    invalid();
  const common = {
    draft_id: uuid(body.broadcastDraftId),
    broadcast_id: uuid(body.marketingBroadcastId),
    recipient_snapshot_id: text(body.recipientSnapshotId, 500),
    send_plan_decision_id: text(body.sendPlanDecisionId, 500),
    replayed: !boolean(body.created),
    requested_recipient_count: requested,
    eligible_recipient_count: eligible,
    refused_recipient_count: refused,
    unknown_recipient_count: unknown,
  };
  return kind === "broadcast_test_queued"
    ? { ...common, kind, audience_targeting: null }
    : { ...common, kind, audience_targeting: targeting! };
}

export function productionTest(value: unknown): ProductionTestResult {
  const body = object(value);
  requireProduction(body);
  if (body.deliveryKind !== "test") invalid();
  const status = testStatus(body.status);
  const submitted = count(body.submittedCount);
  const accepted = count(body.acceptedCount);
  const refused = count(body.refusedCount);
  const unknown = count(body.unknownCount);
  if (accepted + refused + unknown !== submitted) invalid();
  return {
    kind: "production_test",
    draft_id: uuid(body.broadcastDraftId),
    test_id: uuid(body.marketingBroadcastId),
    status,
    poll_after_milliseconds: nullableCount(body.pollAfterMilliseconds),
    submitted_count: submitted,
    accepted_count: accepted,
    refused_count: refused,
    unknown_count: unknown,
    accepted_email_usage_quantity: count(
      object(body.billing).acceptedUsageQuantity,
    ),
  };
}

export function productionProgress(
  value: unknown,
): ProductionBroadcastProgressResult {
  const body = object(value);
  requireProduction(body);
  const status = progressStatus(body.status);
  const requested = count(body.requestedRecipientCount);
  const eligible = count(body.eligibleRecipientCount);
  const released = body.releasedRecipientCount === undefined
    ? eligible
    : count(body.releasedRecipientCount);
  const held = body.heldRecipientCount === undefined
    ? 0
    : count(body.heldRecipientCount);
  const excluded = count(body.excludedRecipientCount);
  const pending = count(body.pendingRecipientCount);
  const claimed = count(body.claimedRecipientCount);
  const accepted = count(body.acceptedRecipientCount);
  const refused = count(body.refusedRecipientCount);
  const unknown = count(body.unknownRecipientCount);
  const cancelled = count(body.cancelledRecipientCount);
  const remaining = count(body.remainingRecipientCount);
  if (
    requested !== eligible + excluded ||
    eligible !== held + pending + claimed + accepted + refused + unknown + cancelled ||
    released + held > eligible ||
    remaining !== held + pending + claimed ||
    (status === "terminal" && remaining !== 0)
  )
    invalid();
  return {
    kind: "broadcast_progress",
    broadcast_id: uuid(body.marketingBroadcastId),
    status,
    control_state: controlStateValue(body.controlState),
    progress_version: text(body.progressVersion, 100),
    requested_recipient_count: requested,
    eligible_recipient_count: eligible,
    released_recipient_count: released,
    held_recipient_count: held,
    excluded_recipient_count: excluded,
    pending_recipient_count: pending,
    claimed_recipient_count: claimed,
    accepted_recipient_count: accepted,
    refused_recipient_count: refused,
    unknown_recipient_count: unknown,
    cancelled_recipient_count: cancelled,
    remaining_recipient_count: remaining,
    current_rate_per_second: nullableNumber(body.currentRatePerSecond),
    as_of: instant(body.asOf),
    estimated_completion_at: nullableInstant(body.estimatedCompletionAt),
  };
}
