import type {
  ProviderPlacementApplicationBinding,
  ProviderPlacementApplicationInput,
  ProviderPlacementCohortInput,
} from "./operator-provider-audience-placement-types.js";
import {
  bounded,
  count,
  environmentValue,
  exact,
  invalid,
  positive,
  sha256,
  stable,
  uuid,
} from "./operator-provider-audience-placement-values.js";

const RECIPIENT_FIELDS = new Set([
  "candidates",
  "contacts",
  "email",
  "emailAddress",
  "normalizedEmail",
  "providerContactId",
  "providerRecordId",
  "recipient",
  "recipients",
  "rowReadback",
  "sourcePayload",
]);

export function providerPlacementApplicationFile(
  value: unknown,
  environment: "sandbox" | "production",
): ProviderPlacementApplicationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  const outgoing = cohort(source.outgoing);
  const body = exact(value, [
    "placement",
    "currentObservationFingerprintSha256",
    "planFingerprintSha256",
    "outgoing",
    "incoming",
    "operatingTargets",
    "idempotencyKey",
    ...(outgoing.count > 0 ? ["retirementCertificate"] : ["workspaceId"]),
  ]);
  assertAggregateOnly(body);
  const binding = applicationBinding(body);
  const placement = placementValue(body.placement);
  if (
    binding.outgoing.contactImportBatchId ===
    binding.incoming.contactImportBatchId
  ) {
    invalid();
  }
  if (binding.outgoing.count === 0) {
    return {
      placement,
      ...binding,
      retirementCertificate: null,
      expectedWorkspaceId: uuid(body.workspaceId),
    };
  }
  const certificate = certificateValue(
    body.retirementCertificate,
    environment,
    placement.source.connectionId,
    binding,
  );
  return {
    placement,
    ...binding,
    retirementCertificate: certificate.value,
    expectedWorkspaceId: certificate.workspaceId,
  };
}

function applicationBinding(
  value: Record<string, unknown>,
): ProviderPlacementApplicationBinding {
  return {
    currentObservationFingerprintSha256: sha256(
      value.currentObservationFingerprintSha256,
    ),
    planFingerprintSha256: sha256(value.planFingerprintSha256),
    outgoing: cohort(value.outgoing),
    incoming: cohort(value.incoming),
    operatingTargets: targets(value.operatingTargets),
    idempotencyKey: uuid(value.idempotencyKey),
  };
}

function placementValue(
  value: unknown,
): ProviderPlacementApplicationInput["placement"] {
  const body = exact(value, ["source", "exclusions"]);
  const source = exact(body.source, [
    "provider",
    "connectionId",
    "collectionType",
    "collectionId",
    "displayName",
    "observationRequirements",
  ]);
  if (
    source.provider !== "resend" ||
    source.collectionType !== "segment" ||
    !Array.isArray(body.exclusions) ||
    body.exclusions.length > 24
  ) {
    invalid();
  }
  const requirements = exact(source.observationRequirements, [
    "completeness",
    "maxAgeSeconds",
  ]);
  const maxAgeSeconds = positive(requirements.maxAgeSeconds);
  if (requirements.completeness !== "complete" || maxAgeSeconds > 86_400) {
    invalid();
  }
  uuid(source.connectionId);
  bounded(source.collectionId, 500);
  bounded(source.displayName, 200);
  return body as unknown as ProviderPlacementApplicationInput["placement"];
}

function certificateValue(
  value: unknown,
  environment: "sandbox" | "production",
  connectionId: string,
  binding: ProviderPlacementApplicationBinding,
): {
  readonly value: Readonly<Record<string, unknown>>;
  readonly workspaceId: string;
} {
  const body = exact(value, [
    "schemaVersion",
    "certificateId",
    "issuedAt",
    "expiresAt",
    "scope",
    "providerEvidence",
    "frozenArtifacts",
    "driftFences",
    "governance",
    "knownLossDisposition",
    "application",
    "certificateChecksumSha256",
  ]);
  const scope = exact(body.scope, [
    "workspaceId",
    "environment",
    "provider",
    "connectionId",
  ]);
  const certificateBinding = applicationBinding(
    exact(body.application, [
      "currentObservationFingerprintSha256",
      "planFingerprintSha256",
      "outgoing",
      "incoming",
      "operatingTargets",
      "idempotencyKey",
    ]),
  );
  if (
    body.schemaVersion !== "provider_retirement_certificate.v1" ||
    scope.provider !== "resend" ||
    environmentValue(scope.environment) !== environment ||
    uuid(scope.connectionId) !== connectionId ||
    stable(certificateBinding) !== stable(binding)
  ) {
    invalid();
  }
  uuid(body.certificateId);
  const workspaceId = uuid(scope.workspaceId);
  sha256(body.certificateChecksumSha256);
  return { value: body, workspaceId };
}

function assertAggregateOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAggregateOnly(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (RECIPIENT_FIELDS.has(key)) invalid();
    assertAggregateOnly(item);
  }
}

function cohort(value: unknown): ProviderPlacementCohortInput {
  const body = exact(value, [
    "contactImportBatchId",
    "sourceChecksumSha256",
    "identitySetSha256",
    "count",
  ]);
  return {
    contactImportBatchId: uuid(body.contactImportBatchId),
    sourceChecksumSha256: sha256(body.sourceChecksumSha256),
    identitySetSha256: sha256(body.identitySetSha256),
    count: count(body.count),
  };
}

function targets(value: unknown) {
  const body = exact(value, [
    "providerContactCount",
    "minimumFonteContactCount",
  ]);
  return {
    providerContactCount: count(body.providerContactCount),
    minimumFonteContactCount: count(body.minimumFonteContactCount),
  };
}
