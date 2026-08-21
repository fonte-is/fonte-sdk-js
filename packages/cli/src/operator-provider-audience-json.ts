import {
  boolean,
  count,
  instant,
  nullableCount,
  object,
  safeText,
  sha256,
  uuid,
} from "./operator-json.js";
import type {
  ProviderAudienceCountsResult,
  ProviderAudienceFreezeResult,
  ProviderAudienceProvider,
  ProviderAudienceReconciliationResult,
  ProviderCollectionListResult,
  ProviderCollectionReferenceResult,
  ProviderObservationSummaryResult,
} from "./operator-provider-audience-types.js";

type Collections = ProviderCollectionListResult;
type Reconciliation = ProviderAudienceReconciliationResult;
type Freeze = ProviderAudienceFreezeResult;
type Unavailable = Reconciliation["unavailable_inputs"][number];

export function providerCollections(value: unknown): Collections {
  const body = object(value);
  const selected = provider(body.provider);
  const collectionType = type(body.collectionType, selected);
  if (body.completeness !== "complete" || !Array.isArray(body.collections)) {
    invalid();
  }
  return {
    kind: "provider_collections",
    provider: selected,
    connection_id: uuid(body.connectionId),
    collection_type: collectionType,
    observed_at: instant(body.observedAt),
    completeness: "complete",
    collections: body.collections.map((value) => {
      const row = object(value);
      return {
        collection_id: collectionId(row.collectionId, selected),
        display_name: safeText(row.displayName, 200),
      };
    }),
  };
}

export function providerAudienceReconciliation(value: unknown): Reconciliation {
  const body = object(value);
  uuid(body.workspaceId);
  const environment = body.environment;
  if (environment !== "sandbox" && environment !== "production") invalid();
  const ready = boolean(body.ready);
  const fingerprint =
    body.observationFingerprint === null
      ? null
      : sha256(body.observationFingerprint);
  const source = body.source === null ? null : summary(body.source);
  if (
    !Array.isArray(body.exclusions) ||
    !Array.isArray(body.unavailableInputs)
  ) {
    invalid();
  }
  const exclusions = body.exclusions.map((value) => {
    const row = object(value);
    return {
      ...summary(row),
      index: count(row.index),
      overlap_count: nullableCount(row.overlapCount),
    };
  });
  const unavailableInputs = body.unavailableInputs.map(unavailable);
  const counts = body.counts === null ? null : countsValue(body.counts);
  if (body.contacts !== null && !Array.isArray(body.contacts)) invalid();
  if (
    ready !==
      Boolean(
        fingerprint && source && counts && Array.isArray(body.contacts),
      ) ||
    (ready && unavailableInputs.length > 0) ||
    (!ready &&
      (fingerprint !== null || counts !== null || body.contacts !== null))
  ) {
    invalid();
  }
  return {
    kind: "provider_audience_reconciliation",
    environment,
    ready,
    observation_fingerprint: fingerprint,
    source,
    exclusions,
    unavailable_inputs: unavailableInputs,
    counts,
  };
}

export function providerAudienceFreeze(value: unknown): Freeze {
  const body = object(value);
  const frozenAudienceId = uuid(body.frozenAudienceId);
  const batchId = uuid(body.contactImportBatchId);
  const expression = object(body.recipientExpression);
  if (
    frozenAudienceId !== batchId ||
    !Array.isArray(expression.include) ||
    expression.include.length !== 1 ||
    !Array.isArray(expression.exclude) ||
    expression.exclude.length !== 0
  ) {
    invalid();
  }
  const include = object(expression.include[0]);
  if (include.kind !== "import_batch") invalid();
  const expressionBatchId = uuid(include.contactImportBatchId);
  if (expressionBatchId !== batchId) invalid();
  return {
    kind: "provider_audience_freeze",
    frozen_audience_id: frozenAudienceId,
    contact_import_batch_id: batchId,
    label: safeText(body.label, 200),
    created: boolean(body.created),
    observation_fingerprint: sha256(body.observationFingerprint),
    counts: countsValue(body.counts),
    recipient_expression: {
      include: [{ kind: "import_batch", contact_import_batch_id: batchId }],
      exclude: [],
    },
  };
}

function summary(value: unknown): ProviderObservationSummaryResult {
  const body = object(value);
  const coverage = object(body.coverage);
  const status = coverage.status;
  if (status !== "complete" && status !== "partial") invalid();
  const pagesObserved = count(coverage.pagesObserved);
  if (pagesObserved < 1) invalid();
  return {
    reference: reference(body.reference),
    observed_at: instant(body.observedAt),
    provider_display_name: nullableText(body.providerDisplayName, 200),
    contacts_observed: count(body.contactsObserved),
    coverage: { status, pages_observed: pagesObserved },
  };
}

function reference(value: unknown): ProviderCollectionReferenceResult {
  const body = object(value);
  const selected = provider(body.provider);
  const requirements = object(body.observationRequirements);
  if (requirements.completeness !== "complete") invalid();
  const maxAgeSeconds = count(requirements.maxAgeSeconds);
  if (maxAgeSeconds < 1 || maxAgeSeconds > 86_400) invalid();
  return {
    provider: selected,
    connection_id: uuid(body.connectionId),
    collection_type: type(body.collectionType, selected),
    collection_id: collectionId(body.collectionId, selected),
    display_name: safeText(body.displayName, 200),
    observation_requirements: {
      completeness: "complete",
      max_age_seconds: maxAgeSeconds,
    },
  };
}

function unavailable(value: unknown): Unavailable {
  const body = object(value);
  const role = body.role;
  const reason = body.reason;
  if (
    (role !== "source" && role !== "exclusion") ||
    !unavailableReason(reason)
  ) {
    invalid();
  }
  const index = nullableCount(body.index);
  if ((role === "source") !== (index === null)) invalid();
  return {
    role,
    index,
    reference: reference(body.reference),
    reason,
    observed_at: body.observedAt === null ? null : instant(body.observedAt),
  };
}

function countsValue(value: unknown): ProviderAudienceCountsResult {
  const body = object(value);
  const result = {
    source: count(body.source),
    exclusion_union: count(body.exclusionUnion),
    protected: count(body.protected),
    unknown: count(body.unknown),
    final: count(body.final),
  };
  if (
    result.source !==
    result.exclusion_union + result.protected + result.unknown + result.final
  ) {
    invalid();
  }
  return result;
}

function provider(value: unknown): ProviderAudienceProvider {
  if (value !== "resend" && value !== "kit") invalid();
  return value;
}

function type(
  value: unknown,
  provider: ProviderAudienceProvider,
): "segment" | "tag" {
  if (provider === "resend" && value === "segment") return value;
  if (provider === "kit" && value === "tag") return value;
  return invalid();
}

function collectionId(
  value: unknown,
  provider: ProviderAudienceProvider,
): string {
  const result = safeText(value, 500);
  if (provider === "kit" && !/^[1-9]\d{0,18}$/.test(result)) invalid();
  return result;
}

function unavailableReason(value: unknown): value is Unavailable["reason"] {
  return [
    "connection_unavailable",
    "collection_missing",
    "provider_unavailable",
    "provider_response_invalid",
    "observation_incomplete",
    "observation_stale",
  ].includes(String(value));
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : safeText(value, maximum);
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
