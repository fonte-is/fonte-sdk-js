import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  providerEvidenceCandidateGeneration,
  providerEvidenceCandidateOperation,
} from "./operator-provider-evidence-json.js";
import type {
  ProviderEvidenceCandidateGenerationInput,
  ProviderEvidenceCandidateGenerationResult,
  ProviderEvidenceCandidateAdvanceInput,
  ProviderEvidenceCandidateOperationInput,
  ProviderEvidenceCandidateOperationResult,
  ProviderEvidenceCandidateScope,
  ProviderEvidenceCandidateSealInput,
  ProviderEvidenceCandidateSelector,
  ProviderEvidenceCandidateStartInput,
} from "./operator-provider-evidence-types.js";

export interface ProviderEvidenceClient {
  startResendCandidateEvidence(
    input: ProviderEvidenceCandidateStartInput,
  ): Promise<ProviderEvidenceCandidateOperationResult>;
  advanceResendCandidateEvidence(
    input: ProviderEvidenceCandidateAdvanceInput,
  ): Promise<ProviderEvidenceCandidateOperationResult>;
  readResendCandidateEvidence(
    input: ProviderEvidenceCandidateOperationInput,
  ): Promise<ProviderEvidenceCandidateOperationResult>;
  sealResendCandidateEvidence(
    input: ProviderEvidenceCandidateSealInput,
  ): Promise<ProviderEvidenceCandidateGenerationResult>;
  readResendCandidateEvidenceGeneration(
    input: ProviderEvidenceCandidateGenerationInput,
  ): Promise<ProviderEvidenceCandidateGenerationResult>;
}
export function createProviderEvidenceClient(request: CoreRequester): ProviderEvidenceClient {
  return {
    async startResendCandidateEvidence(input) {
      validateStart(input);
      const result = parseCoreReceipt(
        providerEvidenceCandidateOperation,
        await request(`${collectionPath(input)}?environment=${input.environment}`, {
          body: {
            operationId: input.operationId,
            connectionId: input.connectionId,
            selector: input.selector,
            candidates: input.candidates,
            schemaVersion: input.schemaVersion,
            normalizationVersion: input.normalizationVersion,
            identityFingerprintVersion: input.identityFingerprintVersion,
            identityCustody: input.identityCustody,
          },
          lostResponseEffect: "unknown",
          idempotencyKey: uuid(input.operationId),
          timeoutMs: 60_000,
        }),
        "unknown",
      );
      return matchingOperation(result, input, "unknown");
    },
    async advanceResendCandidateEvidence(input) {
      validateScope(input);
      const expectedRequestNumber = positiveInteger(input.expectedRequestNumber);
      const result = parseCoreReceipt(
        providerEvidenceCandidateOperation,
        await request(
          `${operationPath(input)}/requests?environment=${input.environment}`,
          { body: { ...guard(input.selector), expectedRequestNumber },
            idempotencyKey: `${uuid(input.operationId)}:${expectedRequestNumber}`,
            lostResponseEffect: "unknown", timeoutMs: 60_000 },
        ),
        "unknown",
      );
      return matchingOperation(result, input, "unknown");
    },
    async readResendCandidateEvidence(input) {
      validateScope(input);
      return matchingOperation(parseCoreReceipt(
        providerEvidenceCandidateOperation,
        await request(`${operationPath(input)}${guardQuery(input)}`),
      ), input, "none");
    },
    async sealResendCandidateEvidence(input) {
      validateScope(input);
      const generationId = uuid(input.generationId);
      const result = parseCoreReceipt(
        providerEvidenceCandidateGeneration,
        await request(
          `${operationPath(input)}/generations?environment=${input.environment}`,
          {
            body: { generationId, ...guard(input.selector) },
            idempotencyKey: generationId,
            lostResponseEffect: "unknown",
          },
        ),
        "unknown",
      );
      return matchingGeneration(result, input, "unknown");
    },
    async readResendCandidateEvidenceGeneration(input) {
      validateScope(input);
      const generationId = uuid(input.generationId);
      const result = parseCoreReceipt(
        providerEvidenceCandidateGeneration,
        await request(
          `${collectionPath(input).replace("candidate-acquisitions", "candidate-generations")}`
            + `/${segment(generationId)}${guardQuery(input)}`,
        ),
      );
      return matchingGeneration(result, input, "none");
    },
  };
}
function validateStart(input: ProviderEvidenceCandidateStartInput): void {
  validateScope(input);
  if (!Array.isArray(input.candidates) || input.candidates.length < 1
    || input.candidates.length > 500_000
    || input.candidates.length !== input.selector.candidateCount) invalidRequest();
  const providerIds = new Set<string>();
  const fingerprints = new Set<string>();
  for (const candidate of input.candidates) {
    const providerId = bounded(candidate.providerRecordId, 500);
    const fingerprint = sha256(candidate.identityFingerprintSha256);
    if (providerIds.has(providerId) || fingerprints.has(fingerprint)) invalidRequest();
    providerIds.add(providerId);
    fingerprints.add(fingerprint);
  }
  version(input.schemaVersion);
  version(input.normalizationVersion);
  if (input.identityFingerprintVersion !== "tenant_hmac_sha256_v1") invalidRequest();
  bounded(input.identityCustody.emailAddressKeyId, 200);
  positiveInteger(input.identityCustody.emailNormalizationVersion);
}
function validateScope(input: ProviderEvidenceCandidateScope & { readonly operationId?: string }) {
  if (input.environment !== "sandbox" && input.environment !== "production") invalidRequest();
  bounded(input.workspace, 200);
  uuid(input.connectionId);
  if (input.operationId !== undefined) uuid(input.operationId);
  validateSelector(input.selector);
}
function validateSelector(value: ProviderEvidenceCandidateSelector): void {
  bounded(value.selectorId, 500);
  uuid(value.selectorGenerationId);
  sha256(value.artifactSha256);
  sha256(value.identitySetSha256);
  positiveInteger(value.candidateCount);
  sha256(value.candidateManifestSha256);
}
function matchingOperation(
  result: ProviderEvidenceCandidateOperationResult,
  input: ProviderEvidenceCandidateOperationInput,
  effect: "none" | "unknown",
): ProviderEvidenceCandidateOperationResult {
  if (result.operation_id !== input.operationId.toLowerCase()
    || result.environment !== input.environment
    || result.connection_id !== input.connectionId.toLowerCase()
    || !sameSelector(result.selector, input.selector)) invalidReceipt(effect);
  return result;
}
function matchingGeneration(
  result: ProviderEvidenceCandidateGenerationResult,
  input: ProviderEvidenceCandidateGenerationInput & { readonly operationId?: string },
  effect: "none" | "unknown",
): ProviderEvidenceCandidateGenerationResult {
  if (result.generation_id !== input.generationId.toLowerCase()
    || input.operationId !== undefined
      && result.source_operation_id !== input.operationId.toLowerCase()
    || result.environment !== input.environment
    || result.connection_id !== input.connectionId.toLowerCase()
    || !sameSelector(result.selector, input.selector)) invalidReceipt(effect);
  return result;
}
function sameSelector(
  actual: ProviderEvidenceCandidateOperationResult["selector"],
  expected: ProviderEvidenceCandidateSelector,
): boolean {
  return actual.selector_id === expected.selectorId
    && actual.selector_generation_id === expected.selectorGenerationId.toLowerCase()
    && actual.artifact_sha256 === expected.artifactSha256
    && actual.identity_set_sha256 === expected.identitySetSha256
    && actual.candidate_count === expected.candidateCount
    && actual.candidate_manifest_sha256 === expected.candidateManifestSha256;
}
function collectionPath(input: { readonly workspace: string }): string {
  return `/v1/workspaces/${segment(input.workspace)}`
    + "/provider-evidence/resend/candidate-acquisitions";
}

function operationPath(input: ProviderEvidenceCandidateOperationInput): string {
  return `${collectionPath(input)}/${segment(uuid(input.operationId))}`;
}

function guardQuery(input: ProviderEvidenceCandidateScope): string {
  const query = new URLSearchParams({
    environment: input.environment,
    ...guard(input.selector),
  });
  return `?${query}`;
}

function guard(selector: ProviderEvidenceCandidateSelector) {
  return {
    selectorGenerationId: uuid(selector.selectorGenerationId),
    artifactSha256: sha256(selector.artifactSha256),
    candidateManifestSha256: sha256(selector.candidateManifestSha256),
  };
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) invalidRequest();
  return value.toLowerCase();
}

function sha256(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) invalidRequest();
  return value;
}

function version(value: string): string {
  const result = bounded(value, 100);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) invalidRequest();
  return result;
}

function bounded(value: string, maximum: number): string {
  if (typeof value !== "string" || !value || value !== value.trim()
    || value.length > maximum || /\p{Cc}/u.test(value)) invalidRequest();
  return value;
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) invalidRequest();
  return value;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalidRequest(): never {
  throw new CoreOperatorError("provider_evidence_candidate_request_invalid", null, "none");
}

function invalidReceipt(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
