import type {
  ProviderPlacementApplicationResult,
  ProviderPlacementCohortResult,
} from "./operator-provider-audience-placement-types.js";
import {
  count,
  environmentValue,
  exact,
  invalid,
  nullableCount,
  nullableInstant,
  nullableInteger,
  nullableSha256,
  sha256,
  stable,
  uuid,
} from "./operator-provider-audience-placement-values.js";

export function providerPlacementApplicationReceipt(
  value: unknown,
  expectedCertificate: Readonly<Record<string, unknown>> | null,
): ProviderPlacementApplicationResult {
  const body = exact(value, [
    "schemaVersion",
    "workspaceId",
    "environment",
    "provider",
    "connectionId",
    "idempotencyKey",
    "retirementCertificate",
    "status",
    "reasonCode",
    "plan",
    "outgoing",
    "incoming",
    "operatingTargets",
    "readback",
  ]);
  if (
    body.schemaVersion !== "provider_placement_application.v1" ||
    body.provider !== "resend" ||
    stable(body.retirementCertificate) !== stable(expectedCertificate)
  ) {
    invalid();
  }
  const environment = environmentValue(body.environment);
  const status = statusValue(body.status);
  const reason = reasonValue(body.reasonCode);
  if ((status === "complete" || status === "pending") !== (reason === null)) {
    invalid();
  }
  const plan = exact(body.plan, [
    "currentObservationFingerprintSha256",
    "planFingerprintSha256",
  ]);
  const targets = targetsValue(body.operatingTargets);
  const outgoing = cohortResult(body.outgoing);
  const incoming = cohortResult(body.incoming);
  const readback = exact(body.readback, [
    "providerPopulationCount",
    "providerTargetHeadroom",
    "fontePopulationCount",
    "providerObservationFingerprintSha256",
    "providerObservedAt",
    "fonteObservedAt",
  ]);
  const population = nullableCount(readback.providerPopulationCount);
  const headroom = nullableInteger(readback.providerTargetHeadroom);
  if (
    (population === null) !== (headroom === null) ||
    (population !== null &&
      headroom !== targets.providerContactCount - population)
  ) {
    invalid();
  }
  return {
    kind: "provider_placement_application",
    workspace_id: uuid(body.workspaceId),
    environment,
    provider: "resend",
    connection_id: uuid(body.connectionId),
    idempotency_key: uuid(body.idempotencyKey),
    retirement_certificate:
      expectedCertificate === null
        ? null
        : {
            certificate_id: uuid(expectedCertificate.certificateId),
            certificate_checksum_sha256: sha256(
              expectedCertificate.certificateChecksumSha256,
            ),
          },
    status,
    reason_code: reason,
    plan: {
      current_observation_fingerprint_sha256: sha256(
        plan.currentObservationFingerprintSha256,
      ),
      plan_fingerprint_sha256: sha256(plan.planFingerprintSha256),
    },
    outgoing,
    incoming,
    operating_targets: {
      provider_contact_count: targets.providerContactCount,
      minimum_fonte_contact_count: targets.minimumFonteContactCount,
    },
    readback: {
      provider_population_count: population,
      provider_target_headroom: headroom,
      fonte_population_count: nullableCount(readback.fontePopulationCount),
      provider_observation_fingerprint_sha256: nullableSha256(
        readback.providerObservationFingerprintSha256,
      ),
      provider_observed_at: nullableInstant(readback.providerObservedAt),
      fonte_observed_at: nullableInstant(readback.fonteObservedAt),
    },
  };
}

function cohortResult(value: unknown): ProviderPlacementCohortResult {
  const body = exact(value, [
    "contactImportBatchId",
    "sourceChecksumSha256",
    "identitySetSha256",
    "count",
    "confirmed",
    "remaining",
  ]);
  const total = count(body.count);
  const confirmed = count(body.confirmed);
  const remaining = count(body.remaining);
  if (confirmed + remaining !== total) invalid();
  return {
    contact_import_batch_id: uuid(body.contactImportBatchId),
    source_checksum_sha256: sha256(body.sourceChecksumSha256),
    identity_set_sha256: sha256(body.identitySetSha256),
    count: total,
    confirmed,
    remaining,
  };
}

function targetsValue(value: unknown) {
  const body = exact(value, [
    "providerContactCount",
    "minimumFonteContactCount",
  ]);
  return {
    providerContactCount: count(body.providerContactCount),
    minimumFonteContactCount: count(body.minimumFonteContactCount),
  };
}

function statusValue(
  value: unknown,
): ProviderPlacementApplicationResult["status"] {
  if (
    ![
      "pending",
      "partial",
      "unknown",
      "blocked",
      "unsupported",
      "complete",
    ].includes(String(value))
  ) {
    invalid();
  }
  return value as ProviderPlacementApplicationResult["status"];
}

function reasonValue(
  value: unknown,
): ProviderPlacementApplicationResult["reason_code"] {
  if (value === null) return null;
  if (
    ![
      "application_remaining",
      "cohort_unavailable",
      "fonte_target_unmet",
      "provider_connection_unavailable",
      "provider_identity_mismatch",
      "provider_readback_unavailable",
      "provider_response_ambiguous",
      "provider_target_mismatch",
      "provider_unsupported",
      "terminal_readback_mismatch",
    ].includes(String(value))
  ) {
    invalid();
  }
  return value as NonNullable<
    ProviderPlacementApplicationResult["reason_code"]
  >;
}
