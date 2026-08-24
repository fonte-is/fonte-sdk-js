import {
  array,
  boolean,
  count,
  requireProduction,
  text,
  uuid,
} from "./operator-production-json-values.js";
import type {
  ProductionAudienceAppendBaselineResult,
  ProductionAudienceAppendInput,
  ProductionAudienceAppendPreflightResult,
  ProductionAudienceAppendResult,
} from "./operator-production-types.js";

const BASELINE_KEYS = [
  "acceptedRecipientCount",
  "cancelledRecipientCount",
  "progressVersion",
  "refusedRecipientCount",
  "segmentCount",
  "unknownRecipientCount",
] as const;

export function audienceAppendPreflight(
  value: unknown,
): ProductionAudienceAppendPreflightResult {
  const body = closedObject(value, [
    "baseline",
    "environment",
    "marketingBroadcastId",
  ]);
  requireProduction(body);
  return {
    broadcast_id: uuid(body.marketingBroadcastId),
    baseline: audienceAppendBaseline(body.baseline),
  };
}

export function audienceAppendResult(
  value: unknown,
  input: ProductionAudienceAppendInput,
  expectedBaseline: ProductionAudienceAppendBaselineResult,
): ProductionAudienceAppendResult {
  const body = closedObject(value, [
    "acceptedTargetCeiling",
    "aggregate",
    "appendAuthorizationId",
    "baseline",
    "environment",
    "idempotencyKey",
    "marketingBroadcastId",
    "replayed",
    "segments",
  ]);
  requireProduction(body);
  const baseline = audienceAppendBaseline(body.baseline);
  if (!sameBaseline(baseline, expectedBaseline)) invalid();
  const aggregateBody = closedObject(body.aggregate, [
    "acceptedRecipientCount",
    "cancelledRecipientCount",
    "refusedRecipientCount",
    "segmentCount",
    "unknownRecipientCount",
  ]);
  const aggregate = {
    accepted_recipient_count: count(aggregateBody.acceptedRecipientCount),
    refused_recipient_count: count(aggregateBody.refusedRecipientCount),
    unknown_recipient_count: count(aggregateBody.unknownRecipientCount),
    cancelled_recipient_count: count(aggregateBody.cancelledRecipientCount),
    segment_count: count(aggregateBody.segmentCount),
  };
  const segments = array(body.segments, 1_000).map(audienceAppendSegment);
  const acceptedTargetCeiling = count(body.acceptedTargetCeiling);
  if (
    uuid(body.marketingBroadcastId) !== input.broadcastId ||
    identifier(body.appendAuthorizationId, 100) !==
      input.appendAuthorizationId ||
    identifier(body.idempotencyKey, 200) !== input.idempotencyKey ||
    acceptedTargetCeiling !== input.acceptedTargetCeiling ||
    aggregate.accepted_recipient_count !== acceptedTargetCeiling ||
    aggregate.accepted_recipient_count < baseline.accepted_recipient_count ||
    aggregate.refused_recipient_count < baseline.refused_recipient_count ||
    aggregate.unknown_recipient_count < baseline.unknown_recipient_count ||
    aggregate.cancelled_recipient_count < baseline.cancelled_recipient_count ||
    aggregate.segment_count !== segments.length ||
    aggregate.segment_count < baseline.segment_count ||
    sum(segments.map((segment) => segment.accepted_recipient_count)) !==
      aggregate.accepted_recipient_count ||
    !segments.some(
      (segment) =>
        segment.frozen_audience_id === input.frozenAudienceId &&
        segment.identity_set_sha256 === input.identitySetSha256,
    )
  ) {
    invalid();
  }
  const indexes = new Set(segments.map((segment) => segment.index));
  if (indexes.size !== segments.length) invalid();
  return {
    kind: "broadcast_audience_append",
    broadcast_id: input.broadcastId,
    append_authorization_id: input.appendAuthorizationId,
    accepted_target_ceiling: acceptedTargetCeiling,
    idempotency_key: input.idempotencyKey,
    replayed: boolean(body.replayed),
    baseline,
    aggregate,
    segments,
  };
}

function audienceAppendBaseline(
  value: unknown,
): ProductionAudienceAppendBaselineResult {
  const body = closedObject(value, BASELINE_KEYS);
  return {
    progress_version: identifier(body.progressVersion, 100),
    accepted_recipient_count: count(body.acceptedRecipientCount),
    refused_recipient_count: count(body.refusedRecipientCount),
    unknown_recipient_count: count(body.unknownRecipientCount),
    cancelled_recipient_count: count(body.cancelledRecipientCount),
    segment_count: count(body.segmentCount),
  };
}

function audienceAppendSegment(
  value: unknown,
): ProductionAudienceAppendResult["segments"][number] {
  const body = closedObject(value, [
    "acceptedRecipientCount",
    "frozenAudienceId",
    "identitySetSha256",
    "index",
    "sourceProvenance",
  ]);
  return {
    index: count(body.index),
    frozen_audience_id: uuid(body.frozenAudienceId),
    identity_set_sha256: sha256(body.identitySetSha256),
    accepted_recipient_count: count(body.acceptedRecipientCount),
    source_provenance:
      body.sourceProvenance === null
        ? null
        : providerSource(body.sourceProvenance),
  };
}

function providerSource(
  value: unknown,
): NonNullable<
  ProductionAudienceAppendResult["segments"][number]["source_provenance"]
> {
  const body = closedObject(value, [
    "collectionId",
    "collectionType",
    "connectionId",
    "provider",
  ]);
  if (body.provider !== "resend" && body.provider !== "kit") invalid();
  if (body.collectionType !== "segment" && body.collectionType !== "tag") {
    invalid();
  }
  return {
    provider: body.provider,
    connection_id: uuid(body.connectionId),
    collection_type: body.collectionType,
    collection_id: text(body.collectionId, 500),
  };
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

function sameBaseline(
  left: ProductionAudienceAppendBaselineResult,
  right: ProductionAudienceAppendBaselineResult,
): boolean {
  return BASELINE_KEYS.every((key) => {
    const resultKey = snakeCaseBaselineKey(key);
    return left[resultKey] === right[resultKey];
  });
}

function snakeCaseBaselineKey(
  key: (typeof BASELINE_KEYS)[number],
): keyof ProductionAudienceAppendBaselineResult {
  const keys: Record<
    (typeof BASELINE_KEYS)[number],
    keyof ProductionAudienceAppendBaselineResult
  > = {
    acceptedRecipientCount: "accepted_recipient_count",
    cancelledRecipientCount: "cancelled_recipient_count",
    progressVersion: "progress_version",
    refusedRecipientCount: "refused_recipient_count",
    segmentCount: "segment_count",
    unknownRecipientCount: "unknown_recipient_count",
  };
  return keys[key];
}

function identifier(value: unknown, maximum: number): string {
  const result = text(value, maximum);
  if (result !== result.trim()) invalid();
  return result;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

function sum(values: readonly number[]): number {
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
