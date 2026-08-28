import type { ProviderCollectionReferenceInput } from "./operator-provider-audience-types.js";

export interface ProviderPlacementCohortInput {
  readonly contactImportBatchId: string;
  readonly sourceChecksumSha256: string;
  readonly identitySetSha256: string;
  readonly count: number;
}

export interface ProviderPlacementApplicationBinding {
  readonly currentObservationFingerprintSha256: string;
  readonly planFingerprintSha256: string;
  readonly outgoing: ProviderPlacementCohortInput;
  readonly incoming: ProviderPlacementCohortInput;
  readonly operatingTargets: {
    readonly providerContactCount: number;
    readonly minimumFonteContactCount: number;
  };
  readonly idempotencyKey: string;
}

export interface ProviderPlacementApplicationInput extends ProviderPlacementApplicationBinding {
  readonly placement: {
    readonly source: Extract<
      ProviderCollectionReferenceInput,
      { readonly provider: "resend" }
    >;
    readonly exclusions: readonly ProviderCollectionReferenceInput[];
  };
  /**
   * Exact Core-owned aggregate retirement certificate, forwarded unchanged for
   * a non-empty outgoing cohort. Core requires no certificate for refill-only
   * applications.
   */
  readonly retirementCertificate: Readonly<Record<string, unknown>> | null;
  /** Expected Core workspace UUID; this guard is never forwarded to Core. */
  readonly expectedWorkspaceId: string;
}

export interface ProviderPlacementCommandInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly application: ProviderPlacementApplicationInput;
}

export type ProviderPlacementOperatorCommand =
  | {
      readonly kind: "bridge_provider_placement_apply";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly applicationFile: string;
    }
  | {
      readonly kind: "bridge_provider_placement_progress";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly applicationFile: string;
    };

export interface ProviderPlacementApplicationResult {
  readonly kind: "provider_placement_application";
  readonly workspace_id: string;
  readonly environment: "sandbox" | "production";
  readonly provider: "resend";
  readonly connection_id: string;
  readonly idempotency_key: string;
  readonly retirement_certificate: {
    readonly certificate_id: string;
    readonly certificate_checksum_sha256: string;
  } | null;
  readonly status:
    "pending" | "partial" | "unknown" | "blocked" | "unsupported" | "complete";
  readonly reason_code:
    | "application_remaining"
    | "cohort_unavailable"
    | "fonte_target_unmet"
    | "provider_connection_unavailable"
    | "provider_identity_mismatch"
    | "provider_readback_unavailable"
    | "provider_response_ambiguous"
    | "provider_target_mismatch"
    | "provider_unsupported"
    | "terminal_readback_mismatch"
    | null;
  readonly plan: {
    readonly current_observation_fingerprint_sha256: string;
    readonly plan_fingerprint_sha256: string;
  };
  readonly outgoing: ProviderPlacementCohortResult;
  readonly incoming: ProviderPlacementCohortResult;
  readonly operating_targets: {
    readonly provider_contact_count: number;
    readonly minimum_fonte_contact_count: number;
  };
  readonly readback: {
    readonly provider_population_count: number | null;
    readonly provider_target_headroom: number | null;
    readonly fonte_population_count: number | null;
    readonly provider_observation_fingerprint_sha256: string | null;
    readonly provider_observed_at: string | null;
    readonly fonte_observed_at: string | null;
  };
}

export interface ProviderPlacementCohortResult {
  readonly contact_import_batch_id: string;
  readonly source_checksum_sha256: string;
  readonly identity_set_sha256: string;
  readonly count: number;
  readonly confirmed: number;
  readonly remaining: number;
}
