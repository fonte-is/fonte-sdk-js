export type ProviderAudienceProvider = "resend" | "kit";

export type ProviderCollectionReferenceInput =
  | ProviderCollectionReference<"resend", "segment">
  | ProviderCollectionReference<"kit", "tag">;

export interface FonteAudienceReferenceInput {
  readonly kind: "fonte_audience";
  readonly contactImportBatchId: string;
  readonly identitySetSha256: string;
  readonly provider?: never;
  readonly connectionId?: never;
  readonly collectionType?: never;
  readonly collectionId?: never;
  readonly displayName?: never;
  readonly observationRequirements?: never;
}

export type ProviderAudienceSourceInput =
  | (ProviderCollectionReferenceInput & {
      readonly kind?: never;
      readonly contactImportBatchId?: never;
      readonly identitySetSha256?: never;
    })
  | FonteAudienceReferenceInput;

interface ProviderCollectionReference<
  Provider extends ProviderAudienceProvider,
  CollectionType extends "segment" | "tag",
> {
  readonly provider: Provider;
  readonly connectionId: string;
  readonly collectionType: CollectionType;
  readonly collectionId: string;
  readonly displayName: string;
  readonly observationRequirements: {
    readonly completeness: "complete";
    readonly maxAgeSeconds: number;
  };
}

export interface ProviderCollectionListInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly provider: ProviderAudienceProvider;
  readonly connectionId: string;
}

export interface ProviderAudienceReconcileInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly source: ProviderAudienceSourceInput;
  readonly exclusions: readonly ProviderCollectionReferenceInput[];
}

export interface ProviderAudienceFreezeInput extends ProviderAudienceReconcileInput {
  readonly expectedObservationFingerprint: string;
  readonly idempotencyKey: string;
}

export type ProviderAudienceOperatorCommand =
  | ({
      readonly kind: "bridge_provider_collections";
    } & ProviderCollectionListInput)
  | ({
      readonly kind: "bridge_provider_reconcile";
    } & ProviderAudienceReconcileInput)
  | ({ readonly kind: "bridge_provider_freeze" } & ProviderAudienceFreezeInput);

export interface ProviderCollectionListResult {
  readonly kind: "provider_collections";
  readonly provider: ProviderAudienceProvider;
  readonly connection_id: string;
  readonly collection_type: "segment" | "tag";
  readonly observed_at: string;
  readonly completeness: "complete";
  readonly collections: readonly {
    readonly collection_id: string;
    readonly display_name: string;
  }[];
}

export interface ProviderCollectionReferenceResult {
  readonly provider: ProviderAudienceProvider;
  readonly connection_id: string;
  readonly collection_type: "segment" | "tag";
  readonly collection_id: string;
  readonly display_name: string;
  readonly observation_requirements: {
    readonly completeness: "complete";
    readonly max_age_seconds: number;
  };
}

export interface ProviderObservationSummaryResult {
  readonly reference: ProviderCollectionReferenceResult;
  readonly observed_at: string;
  readonly provider_display_name: string | null;
  readonly contacts_observed: number;
  readonly coverage: {
    readonly status: "complete" | "partial";
    readonly pages_observed: number;
  };
}

export interface FonteAudienceSummaryResult {
  readonly reference: FonteAudienceReferenceResult;
  readonly contacts_observed: number;
}

export interface FonteAudienceReferenceResult {
  readonly kind: "fonte_audience";
  readonly contact_import_batch_id: string;
  readonly identity_set_sha256: string;
}

export type ProviderAudienceSourceReferenceResult =
  ProviderCollectionReferenceResult | FonteAudienceReferenceResult;

export interface ProviderAudienceCountsResult {
  readonly source: number;
  readonly exclusion_union: number;
  readonly protected: number;
  readonly unknown: number;
  readonly final: number;
}

export interface ProviderAudienceReconciliationResult {
  readonly kind: "provider_audience_reconciliation";
  readonly environment: "sandbox" | "production";
  readonly ready: boolean;
  readonly observation_fingerprint: string | null;
  readonly source:
    ProviderObservationSummaryResult | FonteAudienceSummaryResult | null;
  readonly exclusions: readonly (ProviderObservationSummaryResult & {
    readonly index: number;
    readonly overlap_count: number | null;
  })[];
  readonly unavailable_inputs: readonly {
    readonly role: "source" | "exclusion";
    readonly index: number | null;
    readonly reference: ProviderAudienceSourceReferenceResult;
    readonly reason:
      | "connection_unavailable"
      | "collection_missing"
      | "provider_unavailable"
      | "provider_response_invalid"
      | "observation_incomplete"
      | "observation_stale"
      | "fonte_audience_unavailable"
      | "fonte_audience_identity_mismatch";
    readonly observed_at: string | null;
  }[];
  readonly counts: ProviderAudienceCountsResult | null;
}

export interface ProviderAudienceFreezeResult {
  readonly kind: "provider_audience_freeze";
  readonly frozen_audience_id: string;
  readonly contact_import_batch_id: string;
  readonly label: string;
  readonly created: boolean;
  readonly observation_fingerprint: string;
  readonly counts: ProviderAudienceCountsResult;
  readonly recipient_expression: {
    readonly include: readonly [
      {
        readonly kind: "import_batch";
        readonly contact_import_batch_id: string;
      },
    ];
    readonly exclude: readonly [];
  };
}
