export const COLLECTION_POSTURE_RUNTIME_SCHEMA_VERSION =
  "fonte.collection_posture_browser.v0";
export const COLLECTION_POSTURE_OBSERVATION_SCHEMA_VERSION =
  "fonte.collection_posture_observation.v0";

export type CollectionMode = "full" | "privacy_safe" | "consent_managed";
export type VisitorChoice =
  "user_granted" | "user_denied" | "not_present" | "not_evaluated";

export interface CollectionPostureRuntimeConfig {
  schemaVersion: typeof COLLECTION_POSTURE_RUNTIME_SCHEMA_VERSION;
  collectionMode: CollectionMode;
  policyVersion: string;
  effectiveAt: string;
  visitorChoiceRequired: boolean;
}

export interface CollectionPostureObservation {
  schemaVersion: typeof COLLECTION_POSTURE_OBSERVATION_SCHEMA_VERSION;
  visitorChoice: VisitorChoice;
  policyVersion: string;
}

export interface BrowserCollectionPosture {
  runtime: CollectionPostureRuntimeConfig;
  visitorChoice?: VisitorChoice;
}

export interface ResolvedBrowserCollectionPosture {
  observation: CollectionPostureObservation;
  journeyIdentityScope: "persistent_first_party" | "event_ephemeral";
  persistentIdentityAllowed: boolean;
  adStorageAllowed: boolean;
}

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestamp =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/;
const runtimeKeys = new Set([
  "schemaVersion",
  "collectionMode",
  "policyVersion",
  "effectiveAt",
  "visitorChoiceRequired",
]);

export function normalizeCollectionPostureRuntime(
  value: unknown,
): CollectionPostureRuntimeConfig | null {
  if (!exactRecord(value, runtimeKeys)) return null;
  const input = value as Record<string, unknown>;
  const collectionMode = input.collectionMode;
  const visitorChoiceRequired = input.visitorChoiceRequired;
  if (
    input.schemaVersion !== COLLECTION_POSTURE_RUNTIME_SCHEMA_VERSION ||
    !["full", "privacy_safe", "consent_managed"].includes(
      String(collectionMode),
    ) ||
    typeof input.policyVersion !== "string" ||
    !uuidV4.test(input.policyVersion) ||
    typeof input.effectiveAt !== "string" ||
    !timestamp.test(input.effectiveAt) ||
    !Number.isFinite(Date.parse(input.effectiveAt)) ||
    typeof visitorChoiceRequired !== "boolean" ||
    visitorChoiceRequired !== (collectionMode === "consent_managed")
  )
    return null;
  return input as unknown as CollectionPostureRuntimeConfig;
}

export function normalizeCollectionPostureObservation(
  value: unknown,
): CollectionPostureObservation | null {
  const keys = new Set(["schemaVersion", "visitorChoice", "policyVersion"]);
  if (!exactRecord(value, keys)) return null;
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== COLLECTION_POSTURE_OBSERVATION_SCHEMA_VERSION ||
    !["user_granted", "user_denied", "not_present", "not_evaluated"].includes(
      String(input.visitorChoice),
    ) ||
    typeof input.policyVersion !== "string" ||
    !uuidV4.test(input.policyVersion)
  )
    return null;
  return input as unknown as CollectionPostureObservation;
}

export function resolveBrowserCollectionPosture(
  value: BrowserCollectionPosture | undefined,
): ResolvedBrowserCollectionPosture | null {
  const runtime = normalizeCollectionPostureRuntime(value?.runtime);
  if (!runtime) return null;
  const visitorChoice = value?.visitorChoice;
  if (runtime.collectionMode === "consent_managed") {
    if (
      !visitorChoice ||
      !["user_granted", "user_denied", "not_evaluated"].includes(visitorChoice)
    )
      return null;
  } else if (visitorChoice !== undefined && visitorChoice !== "not_present") {
    return null;
  }
  const observed =
    runtime.collectionMode === "consent_managed"
      ? visitorChoice!
      : "not_present";
  const persistentIdentityAllowed =
    runtime.collectionMode === "full" ||
    (runtime.collectionMode === "consent_managed" &&
      observed === "user_granted");
  return {
    observation: {
      schemaVersion: COLLECTION_POSTURE_OBSERVATION_SCHEMA_VERSION,
      visitorChoice: observed,
      policyVersion: runtime.policyVersion,
    },
    journeyIdentityScope: persistentIdentityAllowed
      ? "persistent_first_party"
      : "event_ephemeral",
    persistentIdentityAllowed,
    adStorageAllowed: persistentIdentityAllowed,
  };
}

function exactRecord(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key))
  );
}
