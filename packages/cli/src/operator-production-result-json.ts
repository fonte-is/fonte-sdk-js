import {
  preflightAudienceSource,
  preflightRecipientExpression,
} from "./operator-preflight-audience-json.js";
import {
  array,
  audienceIdentity,
  audienceKindValue,
  count,
  invalid,
  nullableCount,
  nullableInstant,
  nullableText,
  object,
  progressStatus,
  requireProduction,
  safeProduct,
  text,
  uuid,
} from "./operator-production-json-values.js";
import type {
  FrozenAudienceTargetingResult,
  ProductionBroadcastResult,
} from "./operator-production-types.js";

export function productionResult(value: unknown): ProductionBroadcastResult {
  const body = object(value);
  requireProduction(body);
  const status = progressStatus(body.status);
  const requested = count(body.requestedRecipientCount);
  const eligible = count(body.eligibleRecipientCount);
  const accepted = count(body.providerAcceptedCount);
  const refused = count(body.refusedRecipientCount);
  const unknown = count(body.unknownRecipientCount);
  const pending = count(body.pendingRecipientCount);
  const claimed = count(body.claimedRecipientCount);
  const cancelled = count(body.cancelledRecipientCount);
  if (
    requested < eligible ||
    eligible !== accepted + refused + unknown + pending + claimed + cancelled
  )
    invalid();
  const targeting =
    body.audienceTargeting === null
      ? null
      : frozenAudienceTargeting(body.audienceTargeting);
  if (
    targeting &&
    (targeting.counts.matched !== requested ||
      targeting.counts.final_eligible !== eligible)
  )
    invalid();
  const billable = nullableCount(body.billableAcceptedEmailQuantity);
  const unitPrice = nullableCount(body.unitPriceMicros);
  const accrued = nullableCount(body.accruedAmountMicros);
  if (
    billable !== null &&
    (billable > accepted ||
      (billable === 0 && accrued !== 0) ||
      (billable > 0 && unitPrice === null && accrued !== null) ||
      (billable > 0 &&
        unitPrice !== null &&
        accrued !== safeProduct(billable, unitPrice)))
  )
    invalid();
  return {
    kind: "broadcast_result",
    draft_id: uuid(body.broadcastDraftId),
    broadcast_id: uuid(body.marketingBroadcastId),
    status,
    requested_recipient_count: requested,
    eligible_recipient_count: eligible,
    accepted_recipient_count: accepted,
    refused_recipient_count: refused,
    unknown_recipient_count: unknown,
    pending_recipient_count: pending,
    claimed_recipient_count: claimed,
    cancelled_recipient_count: cancelled,
    delivered_count: count(body.deliveredCount),
    accepted_email_usage_quantity: count(body.acceptedEmailUsageQuantity),
    billable_accepted_email_quantity: billable,
    unit_price_micros: unitPrice,
    accrued_amount_micros: accrued,
    currency: nullableText(body.currency, 20),
    audience_targeting: targeting,
  };
}

export function frozenAudienceTargeting(
  value: unknown,
): FrozenAudienceTargetingResult {
  const body = object(value);
  const audienceKind = audienceKindValue(body.audienceKind);
  const expression =
    body.recipientExpression === null
      ? null
      : preflightRecipientExpression(body.recipientExpression);
  if ((audienceKind === "all_contacts") !== (expression === null)) invalid();
  const matched = count(body.matchedCount);
  const excluded = count(body.excludedCount);
  const protectedCount = count(body.ineligibleProtectedCount);
  const unknown = count(body.unknownCount);
  const eligible = count(body.finalEligibleCount);
  if (matched !== excluded + protectedCount + unknown + eligible) invalid();
  return {
    communication_purpose_id: uuid(body.communicationPurposeId),
    communication_purpose_name: text(body.communicationPurposeName, 100),
    audience_kind: audienceKind,
    recipient_expression: expression,
    source_provenance: array(body.sourceProvenance, 200).map(
      preflightAudienceSource,
    ),
    counts: {
      matched,
      excluded,
      ineligible_protected: protectedCount,
      unknown,
      final_eligible: eligible,
    },
    reuse_evidence:
      body.reuseEvidence === null ? null : reuseEvidence(body.reuseEvidence),
  };
}

function reuseEvidence(
  value: unknown,
): NonNullable<FrozenAudienceTargetingResult["reuse_evidence"]> {
  const body = object(value);
  const identity = object(body.identity);
  if (
    body.version !== "audience_reuse_evidence.v1" ||
    identity.version !== "audience_reuse_identity.v1"
  )
    invalid();
  const prior = count(body.priorAuthorizationCount);
  const latest = nullableInstant(body.latestAuthorizedAt);
  const override = body.override === null ? null : object(body.override);
  if (
    (prior === 0) !== (latest === null) ||
    prior > 0 !== (override !== null) ||
    (override &&
      (override.version !== "audience_reuse_override.v1" ||
        override.acknowledged !== true))
  )
    invalid();
  return {
    identity: audienceIdentity(identity.digest),
    prior_authorization_count: prior,
    latest_authorized_at: latest,
    override_acknowledged: override !== null,
  };
}
