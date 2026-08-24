import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  contactImportStatus,
  providerAudienceFreeze,
  providerAudienceReconciliation,
  providerCollections,
} from "./operator-provider-audience-json.js";
import type {
  ContactImportStatusInput,
  ContactImportStatusResult,
  ProviderAudienceFreezeInput,
  ProviderAudienceFreezeResult,
  ProviderAudienceReconcileInput,
  ProviderAudienceReconciliationResult,
  ProviderAudienceSourceInput,
  ProviderAudienceSourceReferenceResult,
  ProviderCollectionListInput,
  ProviderCollectionListResult,
  ProviderCollectionReferenceInput,
  ProviderCollectionReferenceResult,
} from "./operator-provider-audience-types.js";

export interface ProviderAudienceClient {
  readContactImportStatus(
    input: ContactImportStatusInput,
  ): Promise<ContactImportStatusResult>;
  listProviderCollections(
    input: ProviderCollectionListInput,
  ): Promise<ProviderCollectionListResult>;
  reconcileProviderAudience(
    input: ProviderAudienceReconcileInput,
  ): Promise<ProviderAudienceReconciliationResult>;
  freezeProviderAudience(
    input: ProviderAudienceFreezeInput,
  ): Promise<ProviderAudienceFreezeResult>;
}

export function createProviderAudienceClient(
  request: CoreRequester,
): ProviderAudienceClient {
  return {
    async readContactImportStatus(input) {
      const result = parseCoreReceipt(
        contactImportStatus,
        await request("/v1/broadcast-email/contact-imports", {
          body: {
            workspaceSlug: input.workspace,
            environment: input.environment,
            contactImportBatchId: input.contactImportBatchId,
          },
          lostResponseEffect: "none",
        }),
      );
      if (
        result.environment !== input.environment ||
        result.contact_import_batch_id !==
          input.contactImportBatchId.toLowerCase()
      ) {
        invalidReceipt("none");
      }
      return result;
    },
    async listProviderCollections(input) {
      const result = parseCoreReceipt(
        providerCollections,
        await request(
          `${providerPath(input, "collections")}/${providerSegment(input.provider)}/${connectionSegment(input.connectionId)}?environment=${input.environment}`,
        ),
      );
      if (
        result.provider !== input.provider ||
        result.connection_id !== input.connectionId.toLowerCase()
      ) {
        invalidReceipt("none");
      }
      return result;
    },
    async reconcileProviderAudience(input) {
      const result = parseCoreReceipt(
        providerAudienceReconciliation,
        await request(
          `${providerPath(input, "reconcile")}?environment=${input.environment}`,
          {
            body: { source: input.source, exclusions: input.exclusions },
            lostResponseEffect: "none",
          },
        ),
      );
      if (result.environment !== input.environment || !matches(result, input)) {
        invalidReceipt("none");
      }
      return result;
    },
    async freezeProviderAudience(input) {
      const key = freezeIdempotencyKey(input.idempotencyKey);
      const fingerprint = freezeFingerprint(
        input.expectedObservationFingerprint,
      );
      const result = parseCoreReceipt(
        providerAudienceFreeze,
        await request(
          `${providerPath(input, "freeze")}?environment=${input.environment}`,
          {
            body: {
              source: input.source,
              exclusions: input.exclusions,
              expectedObservationFingerprint: fingerprint,
              idempotencyKey: key,
              ...(input.declaredPermissionBasis
                ? { declaredPermissionBasis: input.declaredPermissionBasis }
                : {}),
            },
            idempotencyKey: key,
            lostResponseEffect: "unknown",
          },
        ),
        "unknown",
      );
      if (result.observation_fingerprint !== fingerprint) {
        invalidReceipt("unknown");
      }
      return result;
    },
  };
}

function providerPath(
  input: { readonly workspace: string; readonly environment: string },
  operation: "collections" | "reconcile" | "freeze",
): string {
  if (input.environment !== "sandbox" && input.environment !== "production") {
    invalidRequest();
  }
  return `/v1/workspaces/${segment(input.workspace)}/bridge/audience/${operation}`;
}

function matches(
  result: ProviderAudienceReconciliationResult,
  input: ProviderAudienceReconcileInput,
): boolean {
  if (
    result.source &&
    !sameSourceReference(result.source.reference, input.source)
  ) {
    return false;
  }
  for (const exclusion of result.exclusions) {
    const expected = input.exclusions[exclusion.index];
    if (!expected || !sameReference(exclusion.reference, expected))
      return false;
  }
  for (const unavailable of result.unavailable_inputs) {
    const expected =
      unavailable.role === "source"
        ? input.source
        : input.exclusions[unavailable.index!];
    if (!expected || !sameSourceReference(unavailable.reference, expected))
      return false;
  }
  if (
    !result.source &&
    !result.unavailable_inputs.some((value) => value.role === "source")
  ) {
    return false;
  }
  for (let index = 0; index < input.exclusions.length; index += 1) {
    if (
      !result.exclusions.some((value) => value.index === index) &&
      !result.unavailable_inputs.some(
        (value) => value.role === "exclusion" && value.index === index,
      )
    ) {
      return false;
    }
  }
  return (
    !result.ready ||
    (result.exclusions.length === input.exclusions.length &&
      new Set(result.exclusions.map((value) => value.index)).size ===
        input.exclusions.length)
  );
}

function sameSourceReference(
  actual: ProviderAudienceSourceReferenceResult,
  expected: ProviderAudienceSourceInput,
): boolean {
  if ("kind" in actual || expected.kind === "fonte_audience") {
    return (
      "kind" in actual &&
      actual.kind === "fonte_audience" &&
      expected.kind === "fonte_audience" &&
      actual.contact_import_batch_id === expected.contactImportBatchId &&
      actual.identity_set_sha256 === expected.identitySetSha256
    );
  }
  return sameReference(actual, expected);
}

function sameReference(
  actual: ProviderCollectionReferenceResult,
  expected: ProviderCollectionReferenceInput,
): boolean {
  return (
    actual.provider === expected.provider &&
    actual.connection_id === expected.connectionId.toLowerCase() &&
    actual.collection_type === expected.collectionType &&
    actual.collection_id === expected.collectionId &&
    actual.display_name === expected.displayName &&
    actual.observation_requirements.max_age_seconds ===
      expected.observationRequirements.maxAgeSeconds
  );
}

function freezeIdempotencyKey(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 120 ||
    /\p{Cc}/u.test(value)
  ) {
    invalidRequest();
  }
  return value;
}

function freezeFingerprint(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) invalidRequest();
  return value;
}

function invalidRequest(): never {
  throw new CoreOperatorError(
    "provider_audience_request_invalid",
    null,
    "none",
  );
}

function invalidReceipt(coreEffect: "none" | "unknown"): never {
  throw new CoreOperatorError(
    "core_operator_receipt_invalid",
    null,
    coreEffect,
  );
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function providerSegment(value: unknown): "resend" | "kit" {
  if (value !== "resend" && value !== "kit") invalidRequest();
  return value;
}

function connectionSegment(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    invalidRequest();
  }
  return segment(value.toLowerCase());
}
