import {
  boolean,
  count,
  instant,
  object,
  safeText,
  sha256,
  uuid,
} from "./operator-json.js";
import type {
  ProviderEvidenceCandidateCoverageResult,
  ProviderEvidenceCandidateGenerationResult,
  ProviderEvidenceCandidateOperationResult,
  ProviderEvidenceCandidateSelectorResult,
} from "./operator-provider-evidence-types.js";

export function providerEvidenceCandidateOperation(
  value: unknown,
): ProviderEvidenceCandidateOperationResult {
  const body = object(value);
  rejectRecipientMaterial(body);
  const status = operationStatus(body.status);
  const nextStage = operationStage(body.nextStage);
  const nextTargetOrdinal = nullablePositiveCount(body.nextTargetOrdinal);
  const observationEndAt = nullableInstant(body.observationEndAt);
  const nextCursorChecksumSha256 = nullableSha256(body.nextCursorChecksumSha256);
  const parsedCoverage = body.coverage === null ? null : coverage(body.coverage);
  if ((status === "acquiring") !== (parsedCoverage === null)
    || (status === "acquiring") !== (observationEndAt === null)
    || (status === "acquiring") === (nextStage === "complete")) invalid();
  const result = {
    kind: "provider_evidence_candidate_acquisition" as const,
    authority: authority(body.authority),
    operation_id: uuid(body.operationId),
    workspace_id: safeText(body.workspaceId, 500),
    environment: environment(body.environment),
    connection_id: uuid(body.connectionId),
    credential_version: positiveCount(body.credentialVersion),
    selector: selector(body.selector),
    status,
    next_stage: nextStage,
    next_target_ordinal: nextTargetOrdinal,
    next_cursor_present: boolean(body.nextCursorPresent),
    next_cursor_checksum_sha256: nextCursorChecksumSha256,
    next_request_number: positiveCount(body.nextRequestNumber),
    provider_call_count: count(body.providerCallCount),
    provider_retry_count: count(body.providerRetryCount),
    provider_throttle_count: count(body.providerThrottleCount),
    rate_limit: rateLimit(body.rateLimit),
    request_count: count(body.requestCount),
    failed_attempt_count: count(body.failedAttemptCount),
    contact_detail_count: count(body.contactDetailCount),
    contact_topic_preference_count: count(body.contactTopicPreferenceCount),
    topic_definition_count: count(body.topicDefinitionCount),
    property_definition_count: count(body.propertyDefinitionCount),
    observation_start_at: instant(body.observationStartAt),
    observation_end_at: observationEndAt,
    coverage: parsedCoverage,
  };
  if (result.provider_retry_count > result.provider_call_count
    || result.provider_throttle_count > result.provider_retry_count
    || result.request_count !== result.next_request_number - 1
    || result.provider_retry_count
      !== result.provider_call_count - result.request_count
    || result.contact_detail_count > result.selector.candidate_count
    || result.next_cursor_present !== (nextCursorChecksumSha256 !== null)
    || status !== "acquiring"
      && result.contact_detail_count !== result.selector.candidate_count
    || status !== "acquiring" && (nextTargetOrdinal !== null
      || result.next_cursor_present)
    || status === "acquiring"
      && isTargetStage(nextStage) !== (nextTargetOrdinal !== null)
    || nextStage === "contact_detail" && result.next_cursor_present
    || observationEndAt !== null
      && Date.parse(observationEndAt) < Date.parse(result.observation_start_at)) invalid();
  return result;
}

export function providerEvidenceCandidateGeneration(
  value: unknown,
): ProviderEvidenceCandidateGenerationResult {
  const body = object(value);
  rejectRecipientMaterial(body);
  const countsBody = object(body.counts);
  const parsedCounts = {
    requests: count(countsBody.requests),
    failed_attempts: count(countsBody.failedAttempts),
    provider_calls: count(countsBody.providerCalls),
    provider_retries: count(countsBody.providerRetries),
    provider_throttles: count(countsBody.providerThrottles),
    contact_details: count(countsBody.contactDetails),
    contact_topic_preferences: count(countsBody.contactTopicPreferences),
    topic_definitions: count(countsBody.topicDefinitions),
    property_definitions: count(countsBody.propertyDefinitions),
  };
  const parsedSelector = selector(body.selector);
  if (parsedCounts.provider_retries > parsedCounts.provider_calls
    || parsedCounts.provider_throttles > parsedCounts.provider_retries
    || parsedCounts.provider_retries
      !== parsedCounts.provider_calls - parsedCounts.requests
    || parsedCounts.contact_details !== parsedSelector.candidate_count) invalid();
  const interval = object(body.observationInterval);
  const start = instant(interval.start);
  const end = instant(interval.end);
  const sealedAt = instant(body.sealedAt);
  if (Date.parse(end) < Date.parse(start) || Date.parse(sealedAt) < Date.parse(end)) invalid();
  return {
    kind: "provider_evidence_candidate_generation",
    authority: authority(body.authority),
    generation_id: uuid(body.generationId),
    source_operation_id: uuid(body.sourceOperationId),
    workspace_id: safeText(body.workspaceId, 500),
    environment: environment(body.environment),
    connection_id: uuid(body.connectionId),
    credential_version: positiveCount(body.credentialVersion),
    selector: parsedSelector,
    counts: parsedCounts,
    coverage: coverage(body.coverage),
    observation_interval: { start, end },
    seal_checksum_sha256: sha256(body.sealChecksumSha256),
    sealed_at: sealedAt,
  };
}

function authority(value: unknown) {
  const body = object(value);
  if (body.provider !== "resend"
    || body.providerAccess !== "candidate_scoped_get_only"
    || body.providerMutation !== "not_granted"
    || body.contactMutation !== "not_granted") invalid();
  return {
    provider: "resend" as const,
    provider_access: "candidate_scoped_get_only" as const,
    provider_mutation: "not_granted" as const,
    contact_mutation: "not_granted" as const,
  };
}

function selector(value: unknown): ProviderEvidenceCandidateSelectorResult {
  const body = object(value);
  return {
    selector_id: safeText(body.selectorId, 500),
    selector_generation_id: uuid(body.selectorGenerationId),
    artifact_sha256: sha256(body.artifactSha256),
    identity_set_sha256: sha256(body.identitySetSha256),
    candidate_count: positiveCount(body.candidateCount),
    candidate_manifest_sha256: sha256(body.candidateManifestSha256),
  };
}

function coverage(value: unknown): ProviderEvidenceCandidateCoverageResult {
  const body = object(value);
  return {
    contact_details_sha256: sha256(body.contactDetailsSha256),
    contact_topics_sha256: sha256(body.contactTopicsSha256),
    definitions_sha256: sha256(body.definitionsSha256),
    complete_coverage_sha256: sha256(body.completeCoverageSha256),
  };
}

function rateLimit(value: unknown): ProviderEvidenceCandidateOperationResult["rate_limit"] {
  if (value === null) return null;
  const body = object(value);
  const result = {
    limit: nullableCount(body.limit),
    remaining: nullableCount(body.remaining),
    reset_seconds: nullableCount(body.resetSeconds),
    retry_after_milliseconds: nullableCount(body.retryAfterMilliseconds),
  };
  if (result.limit !== null && result.remaining !== null
    && result.remaining > result.limit) invalid();
  return result;
}

function isTargetStage(value: ProviderEvidenceCandidateOperationResult["next_stage"]): boolean {
  return value === "contact_detail" || value === "contact_topics";
}

function operationStatus(
  value: unknown,
): ProviderEvidenceCandidateOperationResult["status"] {
  if (value !== "acquiring" && value !== "ready_to_seal" && value !== "sealed") invalid();
  return value;
}

function operationStage(
  value: unknown,
): ProviderEvidenceCandidateOperationResult["next_stage"] {
  if (value !== "topic_definitions" && value !== "property_definitions"
    && value !== "contact_detail" && value !== "contact_topics"
    && value !== "complete") invalid();
  return value;
}

function environment(value: unknown): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") invalid();
  return value;
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

function nullableSha256(value: unknown): string | null {
  return value === null ? null : sha256(value);
}

function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}

function nullablePositiveCount(value: unknown): number | null {
  return value === null ? null : positiveCount(value);
}

function positiveCount(value: unknown): number {
  const result = count(value);
  if (result < 1) invalid();
  return result;
}

function rejectRecipientMaterial(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectRecipientMaterial(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["candidates", "rows", "providerRecordId", "identityFingerprintSha256",
      "email", "emailAddress", "candidateArtifact", "identitySetArtifact",
      "nextCursor"].includes(key)) invalid();
    rejectRecipientMaterial(item);
  }
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
