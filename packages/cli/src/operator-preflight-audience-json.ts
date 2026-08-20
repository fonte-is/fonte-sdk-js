import type {
  PreflightAudienceEvidence,
  PreflightAudienceSource,
  PreflightRecipientExpression,
  PreflightRecipientReference,
} from "./operator-preflight-types.js";

export function preflightAudienceEvidence(
  value: unknown,
): PreflightAudienceEvidence {
  const body = object(value);
  const audienceKind = body.audienceKind;
  if (
    audienceKind !== "all_contacts" &&
    audienceKind !== "recipient_expression"
  )
    invalid();
  const expression =
    body.recipientExpression === null
      ? null
      : preflightRecipientExpression(body.recipientExpression);
  if ((audienceKind === "all_contacts") !== (expression === null)) invalid();
  const counts = object(body.counts);
  const excluded = count(counts.excluded);
  const protectedCount = count(counts.ineligibleProtected);
  const unknown = count(counts.unknown);
  const eligible = count(counts.finalEligible);
  const matched = count(counts.matched);
  if (matched !== excluded + protectedCount + unknown + eligible) invalid();
  return {
    communication_purpose_id: nullableText(body.communicationPurposeId, 500),
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
  };
}

export function preflightRecipientExpression(
  value: unknown,
): PreflightRecipientExpression {
  const body = object(value);
  const include = array(body.include, 20).map(reference);
  const exclude = array(body.exclude, 20).map(reference);
  if (include.length === 0) invalid();
  const keys = [...include, ...exclude].map(referenceKey);
  if (new Set(keys).size !== keys.length) invalid();
  return { include, exclude };
}

function reference(value: unknown): PreflightRecipientReference {
  const body = object(value);
  if (body.kind === "collection") {
    return { kind: "collection", collection_id: uuid(body.collectionId) };
  }
  if (body.kind === "import_batch") {
    return {
      kind: "import_batch",
      contact_import_batch_id: uuid(body.contactImportBatchId),
    };
  }
  return invalid();
}

function referenceKey(value: PreflightRecipientReference): string {
  return value.kind === "collection"
    ? `collection:${value.collection_id}`
    : `import_batch:${value.contact_import_batch_id}`;
}

export function preflightAudienceSource(
  value: unknown,
): PreflightAudienceSource {
  const body = object(value);
  if (body.kind === "collection") {
    if (
      body.collectionKind !== "list" &&
      body.collectionKind !== "segment" &&
      body.collectionKind !== "tag"
    )
      invalid();
    return {
      kind: "collection",
      collection_id: uuid(body.collectionId),
      collection_kind: body.collectionKind,
      label: text(body.label, 500),
      source_connection_id: nullableText(body.sourceConnectionId, 500),
      external_collection_id: nullableText(body.externalCollectionId, 500),
      created_at: instant(body.createdAt),
    };
  }
  if (body.kind === "import_batch") {
    return {
      kind: "import_batch",
      contact_import_batch_id: uuid(body.contactImportBatchId),
      label: nullableText(body.label, 500),
      imported_contact_count: count(body.importedContactCount),
      created_at: instant(body.createdAt),
    };
  }
  return invalid();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\p{C}/u.test(value)
  )
    invalid();
  return value;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) invalid();
  return result;
}

function instant(value: unknown): string {
  const result = text(value, 50);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result)
    invalid();
  return result;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
