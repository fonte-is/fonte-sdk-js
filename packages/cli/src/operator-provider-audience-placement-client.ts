import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { providerPlacementApplicationFile } from "./operator-provider-audience-placement-input.js";
import { providerPlacementApplicationReceipt } from "./operator-provider-audience-placement-json.js";
import type {
  ProviderPlacementApplicationResult,
  ProviderPlacementCommandInput,
} from "./operator-provider-audience-placement-types.js";

export interface ProviderPlacementClient {
  applyProviderPlacement(
    input: ProviderPlacementCommandInput,
  ): Promise<ProviderPlacementApplicationResult>;
  readProviderPlacement(
    input: ProviderPlacementCommandInput,
  ): Promise<ProviderPlacementApplicationResult>;
}

export function createProviderPlacementClient(
  request: CoreRequester,
): ProviderPlacementClient {
  return {
    async applyProviderPlacement(input) {
      const application = placementApplication(input);
      const coreApplication = corePlacementApplication(application);
      const result = parseCoreReceipt(
        (value) =>
          providerPlacementApplicationReceipt(
            value,
            application.retirementCertificate,
          ),
        await request(
          `${placementPath(input, "apply")}?environment=${input.environment}`,
          {
            body: coreApplication,
            idempotencyKey: application.idempotencyKey,
            lostResponseEffect: "unknown",
          },
        ),
        "unknown",
      );
      return matchingPlacement(result, input, application, "unknown");
    },
    async readProviderPlacement(input) {
      const application = placementApplication(input);
      const query = new URLSearchParams({
        environment: input.environment,
        idempotencyKey: application.idempotencyKey,
      });
      const result = parseCoreReceipt(
        (value) =>
          providerPlacementApplicationReceipt(
            value,
            application.retirementCertificate,
          ),
        await request(`${placementPath(input, "progress")}?${query}`),
      );
      return matchingPlacement(result, input, application, "none");
    },
  };
}

function placementApplication(
  input: ProviderPlacementCommandInput,
): ProviderPlacementCommandInput["application"] {
  try {
    const { expectedWorkspaceId, retirementCertificate, ...binding } =
      input.application;
    return providerPlacementApplicationFile(
      retirementCertificate === null
        ? { workspaceId: expectedWorkspaceId, ...binding }
        : { ...binding, retirementCertificate },
      input.environment,
    );
  } catch {
    throw new CoreOperatorError(
      "provider_placement_application_request_invalid",
      null,
      "none",
    );
  }
}

function matchingPlacement(
  result: ProviderPlacementApplicationResult,
  input: ProviderPlacementCommandInput,
  application: ProviderPlacementCommandInput["application"],
  effect: "none" | "unknown",
): ProviderPlacementApplicationResult {
  const source = application.placement.source;
  if (
    result.workspace_id !== application.expectedWorkspaceId ||
    result.environment !== input.environment ||
    result.provider !== "resend" ||
    result.connection_id !== source.connectionId ||
    result.idempotency_key !== application.idempotencyKey ||
    result.plan.current_observation_fingerprint_sha256 !==
      application.currentObservationFingerprintSha256 ||
    result.plan.plan_fingerprint_sha256 !== application.planFingerprintSha256 ||
    !sameCohort(result.outgoing, application.outgoing) ||
    !sameCohort(result.incoming, application.incoming) ||
    result.operating_targets.provider_contact_count !==
      application.operatingTargets.providerContactCount ||
    result.operating_targets.minimum_fonte_contact_count !==
      application.operatingTargets.minimumFonteContactCount ||
    !sameCertificate(
      result.retirement_certificate,
      application.retirementCertificate,
    )
  ) {
    throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
  }
  return result;
}

function corePlacementApplication(
  application: ProviderPlacementCommandInput["application"],
): Readonly<Record<string, unknown>> {
  const {
    expectedWorkspaceId: _expectedWorkspaceId,
    retirementCertificate,
    ...binding
  } = application;
  return retirementCertificate === null
    ? binding
    : { ...binding, retirementCertificate };
}

function sameCertificate(
  actual: ProviderPlacementApplicationResult["retirement_certificate"],
  expected: ProviderPlacementCommandInput["application"]["retirementCertificate"],
): boolean {
  if (expected === null) return actual === null;
  return (
    actual !== null &&
    actual.certificate_id === expected.certificateId &&
    actual.certificate_checksum_sha256 === expected.certificateChecksumSha256
  );
}

function sameCohort(
  actual: ProviderPlacementApplicationResult["outgoing"],
  expected: ProviderPlacementCommandInput["application"]["outgoing"],
): boolean {
  return (
    actual.contact_import_batch_id === expected.contactImportBatchId &&
    actual.source_checksum_sha256 === expected.sourceChecksumSha256 &&
    actual.identity_set_sha256 === expected.identitySetSha256 &&
    actual.count === expected.count
  );
}

function placementPath(
  input: { readonly workspace: string },
  operation: "apply" | "progress",
): string {
  return `/v1/workspaces/${encodeURIComponent(input.workspace)}/bridge/audience/placement-${operation}`;
}
