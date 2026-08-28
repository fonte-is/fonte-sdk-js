export interface ProviderEvidenceCandidateSelectorInput {
  readonly selectorId: string;
  readonly selectorGenerationId: string;
  readonly artifactSha256: string;
  readonly identitySetSha256: string;
  readonly candidateCount: number;
}

export interface ProviderEvidenceCandidateSelector
  extends ProviderEvidenceCandidateSelectorInput {
  readonly candidateManifestSha256: string;
}

export interface ProviderEvidenceCandidateTarget {
  readonly providerRecordId: string;
  readonly identityFingerprintSha256: string;
}

export interface ProviderEvidenceCandidateScope {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly connectionId: string;
  readonly selector: ProviderEvidenceCandidateSelector;
}

export interface ProviderEvidenceCandidateStartInput extends ProviderEvidenceCandidateScope {
  readonly operationId: string;
  readonly candidates: readonly ProviderEvidenceCandidateTarget[];
  readonly schemaVersion: string;
  readonly normalizationVersion: string;
  readonly identityFingerprintVersion: "tenant_hmac_sha256_v1";
  readonly identityCustody: {
    readonly emailAddressKeyId: string;
    readonly emailNormalizationVersion: number;
  };
}

export interface ProviderEvidenceCandidateArtifactStartInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly connectionId: string;
  readonly selector: ProviderEvidenceCandidateSelectorInput;
  readonly operationId: string;
  readonly candidateArtifact: string;
  readonly identitySetArtifact: string;
  readonly schemaVersion: string;
  readonly normalizationVersion: string;
  readonly identityFingerprintVersion: "tenant_hmac_sha256_v1";
  readonly identityCustody: {
    readonly emailAddressKeyId: string;
    readonly emailNormalizationVersion: number;
  };
}

export interface ProviderEvidenceCandidateOperationInput extends ProviderEvidenceCandidateScope {
  readonly operationId: string;
}

export interface ProviderEvidenceCandidateAdvanceInput extends ProviderEvidenceCandidateOperationInput {
  readonly expectedRequestNumber: number;
}

export interface ProviderEvidenceCandidateSealInput extends ProviderEvidenceCandidateOperationInput {
  readonly generationId: string;
}

export interface ProviderEvidenceCandidateGenerationInput extends ProviderEvidenceCandidateScope {
  readonly generationId: string;
}

interface ProviderEvidenceCandidateCommandScope {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly connectionId: string;
  readonly selector: ProviderEvidenceCandidateSelector;
}

interface ProviderEvidenceCandidateOperationCommand extends ProviderEvidenceCandidateCommandScope {
  readonly operationId: string;
}

export type ProviderEvidenceOperatorCommand =
  | (ProviderEvidenceCandidateOperationCommand & {
      readonly kind: "provider_evidence_candidate_start";
      readonly candidatesFile: string;
      readonly schemaVersion: string;
      readonly normalizationVersion: string;
      readonly identityFingerprintVersion: "tenant_hmac_sha256_v1";
      readonly identityCustody: {
        readonly emailAddressKeyId: string;
        readonly emailNormalizationVersion: number;
      };
    })
  | (Omit<ProviderEvidenceCandidateOperationCommand, "selector"> & {
      readonly kind: "provider_evidence_candidate_start";
      readonly selector: ProviderEvidenceCandidateSelectorInput;
      readonly candidateArtifactFile: string;
      readonly identitySetArtifactFile: string;
      readonly schemaVersion: string;
      readonly normalizationVersion: string;
      readonly identityFingerprintVersion: "tenant_hmac_sha256_v1";
      readonly identityCustody: {
        readonly emailAddressKeyId: string;
        readonly emailNormalizationVersion: number;
      };
    })
  | (ProviderEvidenceCandidateOperationCommand & {
      readonly kind: "provider_evidence_candidate_read";
    })
  | (ProviderEvidenceCandidateOperationCommand & {
      readonly kind: "provider_evidence_candidate_advance";
      readonly expectedRequestNumber: number;
    })
  | (ProviderEvidenceCandidateOperationCommand & {
      readonly kind: "provider_evidence_candidate_seal";
      readonly generationId: string;
    })
  | (ProviderEvidenceCandidateCommandScope & {
      readonly kind: "provider_evidence_candidate_generation_read";
      readonly generationId: string;
    });

export interface ProviderEvidenceCandidateSelectorResult {
  readonly selector_id: string;
  readonly selector_generation_id: string;
  readonly artifact_sha256: string;
  readonly identity_set_sha256: string;
  readonly candidate_count: number;
  readonly candidate_manifest_sha256: string;
}

export interface ProviderEvidenceCandidateOperationResult {
  readonly kind: "provider_evidence_candidate_acquisition";
  readonly authority: ProviderEvidenceCandidateAuthorityResult;
  readonly operation_id: string;
  readonly workspace_id: string;
  readonly environment: "sandbox" | "production";
  readonly connection_id: string;
  readonly credential_version: number;
  readonly selector: ProviderEvidenceCandidateSelectorResult;
  readonly status: "acquiring" | "ready_to_seal" | "sealed";
  readonly next_stage:
    | "topic_definitions"
    | "property_definitions"
    | "contact_detail"
    | "contact_topics"
    | "complete";
  readonly next_target_ordinal: number | null;
  readonly next_cursor_present: boolean;
  readonly next_cursor_checksum_sha256: string | null;
  readonly next_request_number: number;
  readonly provider_call_count: number;
  readonly provider_retry_count: number;
  readonly provider_throttle_count: number;
  readonly rate_limit: null | {
    readonly limit: number | null;
    readonly remaining: number | null;
    readonly reset_seconds: number | null;
    readonly retry_after_milliseconds: number | null;
  };
  readonly request_count: number;
  readonly failed_attempt_count: number;
  readonly contact_detail_count: number;
  readonly contact_topic_preference_count: number;
  readonly topic_definition_count: number;
  readonly property_definition_count: number;
  readonly observation_start_at: string;
  readonly observation_end_at: string | null;
  readonly coverage: null | ProviderEvidenceCandidateCoverageResult;
}

export interface ProviderEvidenceCandidateCoverageResult {
  readonly contact_details_sha256: string;
  readonly contact_topics_sha256: string;
  readonly definitions_sha256: string;
  readonly complete_coverage_sha256: string;
}

export interface ProviderEvidenceCandidateAuthorityResult {
  readonly provider: "resend";
  readonly provider_access: "candidate_scoped_get_only";
  readonly provider_mutation: "not_granted";
  readonly contact_mutation: "not_granted";
}

export interface ProviderEvidenceCandidateGenerationResult {
  readonly kind: "provider_evidence_candidate_generation";
  readonly authority: ProviderEvidenceCandidateAuthorityResult;
  readonly generation_id: string;
  readonly source_operation_id: string;
  readonly workspace_id: string;
  readonly environment: "sandbox" | "production";
  readonly connection_id: string;
  readonly credential_version: number;
  readonly selector: ProviderEvidenceCandidateSelectorResult;
  readonly counts: {
    readonly requests: number;
    readonly failed_attempts: number;
    readonly provider_calls: number;
    readonly provider_retries: number;
    readonly provider_throttles: number;
    readonly contact_details: number;
    readonly contact_topic_preferences: number;
    readonly topic_definitions: number;
    readonly property_definitions: number;
  };
  readonly coverage: ProviderEvidenceCandidateCoverageResult;
  readonly observation_interval: {
    readonly start: string;
    readonly end: string;
  };
  readonly seal_checksum_sha256: string;
  readonly sealed_at: string;
}
