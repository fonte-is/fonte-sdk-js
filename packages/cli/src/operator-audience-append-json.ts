import {
  array,
  count,
  instant,
  requireProduction,
  text,
  uuid,
} from "./operator-production-json-values.js";
import type {
  ProductionAudienceAppendBaselineResult,
  ProductionAudienceAppendInput,
  ProductionAudienceAppendPreflightResult,
  ProductionAudienceAppendReadbackResult,
  ProductionAudienceAppendResult,
} from "./operator-production-types.js";

const BASELINE_KEYS = [
  "authorizationId",
  "communicationPurposeId",
  "controlState",
  "currentAcceptedRecipientCount",
  "currentBillingReservedRecipientCount",
  "currentReleasedRecipientCount",
  "currentSnapshotCount",
  "draftVersion",
  "originalRecipientCount",
  "recipientSnapshotId",
  "renderContentDigest",
  "sendPlanDecisionId",
  "senderId",
] as const;
const READBACK_KEYS = [
  "acceptedRecipientCount",
  "authorizationId",
  "controlState",
  "eligibleRecipientCount",
  "heldRecipientCount",
  "marketingBroadcastId",
  "releasedRecipientCount",
  "requestedRecipientCount",
  "segments",
] as const;
const SEGMENT_KEYS = [
  "acceptedEmailUsageQuantity",
  "acceptedRecipientCount",
  "acceptedTargetCeiling",
  "appendAuthorizationId",
  "cancelledRecipientCount",
  "canonicalIdentitySetSha256",
  "complainedRecipientCount",
  "createdAt",
  "deliveredRecipientCount",
  "eligibleRecipientCount",
  "excludedRecipientCount",
  "frozenAudienceId",
  "heldRecipientCount",
  "indeterminateRecipientCount",
  "priorSegmentRecipientCount",
  "protectedRecipientCount",
  "recipientIndexStart",
  "refusedRecipientCount",
  "releasedRecipientCount",
  "segment",
  "sourceProvenance",
  "sourceRecipientCount",
  "unknownRecipientCount",
] as const;

export function audienceAppendPreflight(
  value: unknown,
): ProductionAudienceAppendPreflightResult {
  const body = closedObject(value, [
    "baseline",
    "environment",
    "readback",
    "tenantId",
  ]);
  requireProduction(body);
  const result = {
    tenant_id: identifier(body.tenantId, 200),
    baseline: audienceAppendBaseline(body.baseline),
    readback: audienceAppendReadback(body.readback),
  };
  if (
    result.baseline.authorization_id !== result.readback.authorization_id ||
    result.baseline.current_snapshot_count !==
      result.readback.aggregate.eligible_recipient_count ||
    result.baseline.current_released_recipient_count !==
      result.readback.aggregate.released_recipient_count ||
    result.baseline.current_accepted_recipient_count !==
      result.readback.aggregate.accepted_recipient_count ||
    result.baseline.control_state !== result.readback.aggregate.control_state
  ) {
    invalid();
  }
  return result;
}

export function audienceAppendResult(
  value: unknown,
  input: ProductionAudienceAppendInput,
  preflight: ProductionAudienceAppendPreflightResult,
): ProductionAudienceAppendResult {
  const body = closedObject(value, [
    "environment",
    "tenantId",
    ...READBACK_KEYS,
  ]);
  requireProduction(body);
  if (identifier(body.tenantId, 200) !== preflight.tenant_id) invalid();
  const readback = audienceAppendReadback({
    acceptedRecipientCount: body.acceptedRecipientCount,
    authorizationId: body.authorizationId,
    controlState: body.controlState,
    eligibleRecipientCount: body.eligibleRecipientCount,
    heldRecipientCount: body.heldRecipientCount,
    marketingBroadcastId: body.marketingBroadcastId,
    releasedRecipientCount: body.releasedRecipientCount,
    requestedRecipientCount: body.requestedRecipientCount,
    segments: body.segments,
  });
  if (
    readback.broadcast_id !== input.broadcastId ||
    readback.authorization_id !== preflight.baseline.authorization_id ||
    readback.aggregate.accepted_recipient_count > input.acceptedTargetCeiling ||
    matchingAppendSegments(readback, input).length !== 1
  ) {
    invalid();
  }
  return {
    kind: "broadcast_audience_append",
    broadcast_id: input.broadcastId,
    append_authorization_id: input.appendAuthorizationId,
    accepted_target_ceiling: input.acceptedTargetCeiling,
    idempotency_key: input.idempotencyKey,
    replayed: matchingAppendSegments(preflight.readback, input).length === 1,
    baseline: preflight.baseline,
    aggregate: readback.aggregate,
    segments: readback.segments,
  };
}

function audienceAppendBaseline(
  value: unknown,
): ProductionAudienceAppendBaselineResult {
  const body = closedObject(value, BASELINE_KEYS);
  return {
    authorization_id: identifier(body.authorizationId, 200),
    recipient_snapshot_id: versionedUuid(body.recipientSnapshotId),
    send_plan_decision_id: versionedUuid(body.sendPlanDecisionId),
    draft_version: positiveCount(body.draftVersion),
    sender_id: identifier(body.senderId, 200),
    render_content_digest: prefixedSha256(body.renderContentDigest),
    communication_purpose_id: versionedUuid(body.communicationPurposeId),
    original_recipient_count: positiveCount(body.originalRecipientCount),
    current_snapshot_count: positiveCount(body.currentSnapshotCount),
    current_released_recipient_count: count(body.currentReleasedRecipientCount),
    current_accepted_recipient_count: count(body.currentAcceptedRecipientCount),
    current_billing_reserved_recipient_count: positiveCount(
      body.currentBillingReservedRecipientCount,
    ),
    control_state: activeControlState(body.controlState),
  };
}

function audienceAppendReadback(
  value: unknown,
): ProductionAudienceAppendReadbackResult {
  const body = closedObject(value, READBACK_KEYS);
  const requested = count(body.requestedRecipientCount);
  const eligible = count(body.eligibleRecipientCount);
  const released = count(body.releasedRecipientCount);
  const accepted = count(body.acceptedRecipientCount);
  const held = count(body.heldRecipientCount);
  const segments = array(body.segments, 1_000).map(audienceAppendSegment);
  if (
    requested < eligible ||
    accepted > released ||
    released + held > eligible ||
    safeSum(segments.map((segment) => segment.eligible_recipient_count)) !==
      eligible
  ) {
    invalid();
  }
  return {
    broadcast_id: uuid(body.marketingBroadcastId),
    authorization_id: identifier(body.authorizationId, 200),
    aggregate: {
      requested_recipient_count: requested,
      eligible_recipient_count: eligible,
      released_recipient_count: released,
      accepted_recipient_count: accepted,
      held_recipient_count: held,
      control_state: controlState(body.controlState),
    },
    segments,
  };
}

function audienceAppendSegment(
  value: unknown,
): ProductionAudienceAppendReadbackResult["segments"][number] {
  const body = closedObject(value, SEGMENT_KEYS);
  const segment = body.segment;
  if (segment !== "original" && segment !== "append") invalid();
  const appendAuthorizationId = nullableIdentifier(
    body.appendAuthorizationId,
    200,
  );
  const frozenAudienceId = nullableUuid(body.frozenAudienceId);
  const canonicalIdentitySetSha256 = nullableSha256(
    body.canonicalIdentitySetSha256,
  );
  const acceptedTargetCeiling = nullablePositiveCount(
    body.acceptedTargetCeiling,
  );
  if (
    segment === "original"
      ? appendAuthorizationId !== null ||
        canonicalIdentitySetSha256 !== null ||
        acceptedTargetCeiling !== null
      : appendAuthorizationId === null ||
        frozenAudienceId === null ||
        canonicalIdentitySetSha256 === null ||
        acceptedTargetCeiling === null
  ) {
    invalid();
  }
  const source = count(body.sourceRecipientCount);
  const prior = count(body.priorSegmentRecipientCount);
  const excluded = count(body.excludedRecipientCount);
  const protectedCount = count(body.protectedRecipientCount);
  const unknown = count(body.unknownRecipientCount);
  const eligible = count(body.eligibleRecipientCount);
  const released = count(body.releasedRecipientCount);
  const held = count(body.heldRecipientCount);
  const accepted = count(body.acceptedRecipientCount);
  if (
    source !== prior + excluded + protectedCount + unknown + eligible ||
    released + held > eligible ||
    accepted > released
  ) {
    invalid();
  }
  return {
    segment,
    append_authorization_id: appendAuthorizationId,
    frozen_audience_id: frozenAudienceId,
    canonical_identity_set_sha256: canonicalIdentitySetSha256,
    recipient_index_start: count(body.recipientIndexStart),
    source_recipient_count: source,
    prior_segment_recipient_count: prior,
    excluded_recipient_count: excluded,
    protected_recipient_count: protectedCount,
    unknown_recipient_count: unknown,
    eligible_recipient_count: eligible,
    accepted_target_ceiling: acceptedTargetCeiling,
    released_recipient_count: released,
    held_recipient_count: held,
    accepted_recipient_count: accepted,
    refused_recipient_count: count(body.refusedRecipientCount),
    indeterminate_recipient_count: count(body.indeterminateRecipientCount),
    cancelled_recipient_count: count(body.cancelledRecipientCount),
    delivered_recipient_count: count(body.deliveredRecipientCount),
    complained_recipient_count: count(body.complainedRecipientCount),
    accepted_email_usage_quantity: count(body.acceptedEmailUsageQuantity),
    created_at: instant(body.createdAt),
  };
}

function matchingAppendSegments(
  readback: ProductionAudienceAppendReadbackResult,
  input: ProductionAudienceAppendInput,
) {
  return readback.segments.filter(
    (segment) =>
      segment.segment === "append" &&
      segment.append_authorization_id === input.appendAuthorizationId &&
      segment.frozen_audience_id === input.frozenAudienceId &&
      segment.canonical_identity_set_sha256 === input.identitySetSha256 &&
      segment.accepted_target_ceiling === input.acceptedTargetCeiling,
  );
}

function closedObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid();
  }
  return body;
}

function activeControlState(value: unknown): "active" | "paused" {
  if (value !== "active" && value !== "paused") invalid();
  return value;
}

function controlState(value: unknown): "active" | "paused" | "cancelled" {
  if (value !== "active" && value !== "paused" && value !== "cancelled") {
    invalid();
  }
  return value;
}

function identifier(value: unknown, maximum: number): string {
  const result = text(value, maximum);
  if (result !== result.trim()) invalid();
  return result;
}

function nullableIdentifier(value: unknown, maximum: number): string | null {
  return value === null ? null : identifier(value, maximum);
}

function versionedUuid(value: unknown): string {
  const result = uuid(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  ) {
    invalid();
  }
  return result;
}

function nullableUuid(value: unknown): string | null {
  return value === null ? null : versionedUuid(value);
}

function prefixedSha256(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    invalid();
  }
  return value;
}

function nullableSha256(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) invalid();
  return value;
}

function positiveCount(value: unknown): number {
  const result = count(value);
  if (result < 1) invalid();
  return result;
}

function nullablePositiveCount(value: unknown): number | null {
  return value === null ? null : positiveCount(value);
}

function safeSum(values: readonly number[]): number {
  let result = 0;
  for (const value of values) {
    result += value;
    if (!Number.isSafeInteger(result)) invalid();
  }
  return result;
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
