export interface ProviderRotationStartInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly iterationId: string;
  readonly connectionId: string;
  readonly candidateOperationId: string;
  readonly outgoingCandidateOperationId: string;
  readonly populationSelectorGenerationId: string;
  readonly placementSegmentId: string;
  readonly qualifyingBroadcastId: string;
  readonly orderedBroadcastIds: readonly string[];
  readonly coldRemaining: number;
  readonly identityCustody: {
    readonly emailAddressKeyId: string;
    readonly emailNormalizationVersion: number;
  };
}

export interface ProviderRotationAdvanceInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly iterationId: string;
  readonly expectedPageNumber: number;
}

export interface ProviderRotationReadInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly iterationId: string;
}

export interface ProviderRotationSealInput extends ProviderRotationReadInput {
  readonly candidateGenerationId: string;
  readonly partitionGenerationId: string;
  readonly qualifyingBroadcastId: string;
  readonly orderedBroadcastIds: readonly string[];
}

export type ProviderRotationOperatorCommand =
  | ({
      readonly kind: "bridge_provider_rotation_start";
    } & ProviderRotationStartInput)
  | ({
      readonly kind: "bridge_provider_rotation_advance";
    } & ProviderRotationAdvanceInput)
  | ({
      readonly kind: "bridge_provider_rotation_read";
    } & ProviderRotationReadInput)
  | ({
      readonly kind: "bridge_provider_rotation_seal";
    } & ProviderRotationSealInput);

export interface ProviderRotationSelectorResult {
  readonly selectorId: string;
  readonly selectorGenerationId: string;
  readonly artifactSha256: string;
  readonly identitySetSha256: string;
  readonly candidateCount: number;
  readonly candidateManifestSha256: string;
}

export type ProviderRotationReason =
  | "retirement_evidence_complete"
  | "canonical_import_not_completed"
  | "no_message_history"
  | "no_recent_message_history"
  | "provider_unsubscribe"
  | "provider_bounce"
  | "provider_complaint"
  | "provider_suppression"
  | "fonte_recipient_not_eligible"
  | "provider_eligibility_unknown"
  | "identity_unknown"
  | "evidence_missing"
  | "evidence_contradictory"
  | "relationship_evidence_not_preserved";

export interface ProviderRotationResult {
  readonly kind: "provider_rotation_partition";
  readonly schemaVersion: "provider_rotation_partition.v1";
  readonly orderingVersion: "provider_rotation_engagement_created_email.v1";
  readonly authority: {
    readonly provider: "resend";
    readonly providerAccess: "get_only_stored_credential";
    readonly providerMutation: "not_granted";
    readonly unknownAllowsEffect: false;
  };
  readonly iterationId: string;
  readonly workspaceId: string;
  readonly environment: "sandbox" | "production";
  readonly connectionId: string;
  readonly placementSegmentId: string;
  readonly credentialVersion: number;
  readonly status:
    | "acquiring_population"
    | "population_ready"
    | "population_changed"
    | "acquiring_broadcasts"
    | "acquiring_evidence"
    | "complete"
    | "blocked_unknown";
  readonly populationProgress: {
    readonly convergencePass: 1 | 2;
    readonly nextPageNumber: number;
    readonly nextCursorPresent: boolean;
    readonly nextCursorChecksumSha256: string | null;
    readonly pages: number;
    readonly providerCalls: number;
    readonly providerRetries: number;
    readonly providerThrottles: number;
  };
  readonly population: null | {
    readonly selectorGenerationId: string;
    readonly count: number;
    readonly rootSha256: string;
    readonly artifactSha256: string;
    readonly candidateManifestSha256: string;
    readonly observedAt: { readonly start: string; readonly end: string };
  };
  readonly broadcastProgress: {
    readonly qualifyingBroadcastId: string;
    readonly orderedBroadcastIds: readonly string[];
    readonly nextBroadcastOrdinal: number | null;
    readonly nextStage:
      "metadata" | "accepted" | "delivered" | "opened" | "clicked" | null;
    readonly nextCursorPresent: boolean;
    readonly nextCursorChecksumSha256: string | null;
    readonly pages: number;
    readonly providerCalls: number;
    readonly providerRetries: number;
    readonly providerThrottles: number;
  };
  readonly broadcastEvidence: null | {
    readonly broadcasts: readonly {
      readonly broadcastId: string;
      readonly sentAt: string;
      readonly outcomes: Readonly<
        Record<
          "accepted" | "delivered" | "opened" | "clicked",
          { readonly count: number; readonly identitySetSha256: string }
        >
      >;
    }[];
    readonly evidenceChecksumSha256: string;
  };
  readonly candidateAcquisition:
    | (ProviderRotationSelectorResult & {
        readonly operationId: string;
      })
    | null;
  readonly outgoingCandidateAcquisition:
    | (ProviderRotationSelectorResult & {
        readonly operationId: string;
      })
    | null;
  readonly outgoingIntake: null | {
    readonly schemaVersion: "provider_rotation_intake.v1";
    readonly contactImportBatchId: string;
    readonly sourceChecksumSha256: string;
    readonly fonteIdentitySetSha256: string;
    readonly count: number;
    readonly selector: ProviderRotationSelectorResult;
    readonly bindingChecksumSha256: string;
  };
  readonly coldRemaining: number;
  readonly partition: null | {
    readonly schemaVersion: "provider_rotation_partition.v1";
    readonly orderingVersion: "provider_rotation_engagement_created_email.v1";
    readonly status: "complete" | "blocked_unknown";
    readonly populationCount: number;
    readonly populationRootSha256: string;
    readonly counts: Readonly<Record<"E" | "W" | "X" | "U", number>>;
    readonly reasonCounts: readonly {
      readonly category: "E" | "W" | "X" | "U";
      readonly reason: ProviderRotationReason;
      readonly count: number;
    }[];
    readonly selectors: Readonly<
      Record<"E" | "W" | "X" | "U", ProviderRotationSelectorResult>
    >;
    readonly outgoing: ProviderRotationSelectorResult | null;
    readonly outgoingCount: number;
    readonly coldRemaining: number;
    readonly unionConservationSha256: string;
    readonly partitionChecksumSha256: string;
  };
  readonly candidateGenerationId: string | null;
  readonly partitionGenerationId: string | null;
}
