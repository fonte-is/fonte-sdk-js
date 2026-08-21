import type {
  ResendBridgeCopyResult,
  ResendBridgeCoverage,
  ResendBridgePreviewResult,
  SandboxTestResult,
} from "./operator-types.js";

export function queuedSandboxTest(value: unknown): SandboxTestResult {
  const body = object(value);
  if (body.status !== "queued") invalid();
  const recipient = object(body.recipient);
  if (recipient.kind !== "verified_account_email") invalid();
  return {
    kind: "sandbox_test",
    test_id: text(body.sandboxEmailId),
    status: "queued",
    replayed: boolean(body.replayed),
    accepted_count: null,
    refused_count: null,
    unknown_count: null,
    accepted_email_usage_quantity: null,
    poll_after_milliseconds: null,
  };
}

export function sandboxTest(value: unknown): SandboxTestResult {
  const body = object(value);
  if (body.status !== "processing" && body.status !== "terminal") invalid();
  const provider = object(body.provider);
  const billing = object(body.billing);
  const accepted = count(provider.acceptedCount);
  const refused = count(provider.refusedCount);
  const unknown = count(provider.unknownCount);
  const quantity = nullableCount(billing.quantity);
  if (
    body.status === "terminal" &&
    (accepted + refused + unknown !== 1 || quantity !== accepted)
  )
    invalid();
  return {
    kind: "sandbox_test",
    test_id: text(body.sandboxEmailId),
    status: body.status,
    replayed: null,
    accepted_count: accepted,
    refused_count: refused,
    unknown_count: unknown,
    accepted_email_usage_quantity: quantity,
    poll_after_milliseconds: nullableCount(body.pollAfterMilliseconds),
  };
}

export function resendBridgePreview(value: unknown): ResendBridgePreviewResult {
  const body = object(value);
  if (body.provider !== "resend") invalid();
  const segment = object(body.segment);
  const pagination = object(body.pagination);
  const contacts = coverage(pagination.contacts);
  const suppressions = coverage(pagination.suppressions);
  const status = coverageStatus(pagination.status);
  if (
    status !==
    (contacts.status === "complete" && suppressions.status === "complete"
      ? "complete"
      : "partial")
  )
    invalid();
  const protectedObservations = object(body.protectedObservations);
  const unknowns = object(body.unknowns);
  const contactsObserved = count(body.contactsObserved);
  const protectedContacts = count(protectedObservations.contacts);
  const providerUnsubscribed = count(
    protectedObservations.providerUnsubscribed,
  );
  const providerSuppressed = count(protectedObservations.providerSuppressed);
  const unknownContacts = count(unknowns.contacts);
  if (
    protectedContacts > contactsObserved ||
    providerUnsubscribed > contactsObserved ||
    providerSuppressed > contactsObserved ||
    unknownContacts > contactsObserved ||
    unknowns.automationDependency !== "unknown"
  )
    invalid();
  return {
    kind: "resend_bridge_preview",
    provider: "resend",
    connection_id: safeText(body.connectionId, 200),
    segment: {
      id: safeText(segment.id, 500),
      name: safeText(segment.name, 500),
    },
    observed_at: instant(body.observedAt),
    observation_fingerprint: sha256(body.observationFingerprint),
    pagination: { status, contacts, suppressions },
    contacts_observed: contactsObserved,
    protected: {
      contacts: protectedContacts,
      provider_unsubscribed: providerUnsubscribed,
      provider_suppressed: providerSuppressed,
    },
    unknown: {
      contacts: unknownContacts,
      property_observations: count(unknowns.propertyObservations),
      suppression_observations: count(unknowns.suppressionObservations),
      automation_dependency: "unknown",
    },
  };
}

export function resendBridgeCopy(value: unknown): ResendBridgeCopyResult {
  const preview = resendBridgePreview(value);
  const body = object(value);
  const importReceipt = object(body.importReceipt);
  const reconciliation = object(body.reconciliation);
  sha256(importReceipt.sourceChecksumSha256);
  safeText(importReceipt.idempotencyKey, 500);
  const accepted = count(reconciliation.accepted);
  const created = count(reconciliation.created);
  const protectedContacts = count(reconciliation.protected);
  const unknownContacts = count(reconciliation.unknown);
  if (
    accepted > preview.contacts_observed ||
    created > accepted ||
    protectedContacts > preview.contacts_observed ||
    unknownContacts > preview.contacts_observed
  )
    invalid();
  return {
    ...preview,
    kind: "resend_bridge_copy",
    import_receipt: {
      contact_import_batch_id: uuid(importReceipt.contactImportBatchId),
      created: boolean(importReceipt.created),
    },
    reconciliation: {
      accepted,
      created,
      updated: nullableCount(reconciliation.updated),
      unchanged: nullableCount(reconciliation.unchanged),
      protected: protectedContacts,
      conflict: nullableCount(reconciliation.conflict),
      unknown: unknownContacts,
    },
  };
}

export function coreError(value: unknown, status: number): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string" && /^[a-z0-9_]{1,100}$/.test(error)) {
      return error;
    }
  }
  return `core_request_failed_${status}`;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function coverage(value: unknown): ResendBridgeCoverage {
  const body = object(value);
  return {
    status: coverageStatus(body.status),
    pages_observed: count(body.pagesObserved),
    has_more: boolean(body.hasMore),
  };
}

function coverageStatus(value: unknown): "complete" | "partial" {
  if (value !== "complete" && value !== "partial") invalid();
  return value;
}

function text(value: unknown): string {
  return safeText(value, 500);
}

export function safeText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\p{C}/u.test(value)
  )
    invalid();
  return value;
}

export function uuid(value: unknown): string {
  const result = safeText(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) invalid();
  return result;
}

export function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

export function instant(value: unknown): string {
  const result = safeText(value, 50);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result)
    invalid();
  return result;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

export function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

export function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
