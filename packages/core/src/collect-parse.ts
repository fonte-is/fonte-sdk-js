import {
  adStorageQueryKeys,
  canonicalizePageUrl,
  canonicalizeCurrentUrl,
  clean,
  measurementQueryKeys,
  scopeKeys,
} from "./collect-contract.js";
import type {
  CollectBody,
  CollectEventType,
  Evidence,
  ParseOptions,
} from "./collect-types.js";
import { BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION } from "./collect-types.js";
import { normalizeCollectionPostureObservation } from "./collection-posture.js";
import { normalizeInstallationVerification } from "./installation-verification.js";
import type { Scope } from "./types.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const eventTypes = new Set<CollectEventType>(["page_view", "source_touch"]);
const identityScopes = new Set(["persistent_first_party", "event_ephemeral"]);
const requiredBodyKeys = new Set([
  "schemaVersion",
  "eventId",
  "eventType",
  "occurredAt",
  "journeyIdentityScope",
  "collectionPostureObservation",
  "scope",
]);

const origin = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const canonicalOrigin = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return value === parsed.origin &&
      ["http:", "https:"].includes(parsed.protocol)
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
};

const normalizeScope = (value: unknown): Scope | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !scopeKeys.has(key))) return null;
  const rawScope = value as Record<string, unknown>;
  const rawCurrentUrl = clean(rawScope.current_url, 2048);
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(rawCurrentUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(sourceUrl.protocol)) return null;
  const scope: Scope = {};
  for (const [key, raw] of Object.entries(value)) {
    const maxLength = key === "current_url" || key === "referrer" ? 2048 : 500;
    const normalized = clean(raw, maxLength);
    if (normalized) scope[key] = normalized;
  }
  if (
    !scope.current_url ||
    scope.canonical_route !== sourceUrl.pathname ||
    ["fonte", ...measurementQueryKeys, ...adStorageQueryKeys].some(
      (key) =>
        scope[key] !== undefined &&
        sourceUrl.search.length > 0 &&
        sourceUrl.searchParams.get(key) !== scope[key],
    )
  )
    return null;
  scope.current_url = canonicalizeCurrentUrl(scope).current_url;
  if (scope.referrer) {
    const referrer = canonicalizePageUrl(scope.referrer);
    if (!referrer) return null;
    scope.referrer = referrer;
  }
  return scope;
};

const exactBodyKeys = (input: Record<string, unknown>): boolean => {
  const expected = new Set(requiredBodyKeys);
  if (input.journeyId !== undefined) expected.add("journeyId");
  if (input.verification !== undefined) expected.add("verification");
  const keys = Object.keys(input);
  return (
    keys.length === expected.size && keys.every((key) => expected.has(key))
  );
};

const canonicalTimestamp = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try {
    return new Date(value).toISOString() === value ? value : "";
  } catch {
    return "";
  }
};

const normalizeBody = (value: unknown): CollectBody | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactBodyKeys(input)) return null;
  const eventId = clean(input.eventId, 80).toLowerCase();
  const eventType = clean(input.eventType, 40) as CollectEventType;
  const journeyId = clean(input.journeyId, 80).toLowerCase();
  const journeyIdentityScope = clean(
    input.journeyIdentityScope,
    40,
  ) as CollectBody["journeyIdentityScope"];
  const occurredAt = canonicalTimestamp(input.occurredAt);
  const collectionPostureObservation = normalizeCollectionPostureObservation(
    input.collectionPostureObservation,
  );
  const scope = normalizeScope(input.scope);
  if (
    input.schemaVersion !== BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION ||
    !uuidPattern.test(eventId) ||
    !eventTypes.has(eventType) ||
    !occurredAt ||
    !identityScopes.has(journeyIdentityScope) ||
    !collectionPostureObservation ||
    !scope ||
    (eventType === "page_view" && input.verification !== undefined) ||
    (journeyIdentityScope === "persistent_first_party" &&
      (!uuidPattern.test(journeyId) || scope.fonte_journey_id !== journeyId)) ||
    (journeyIdentityScope === "event_ephemeral" &&
      (journeyId ||
        scope.fonte_journey_id ||
        scope.fonte_device_id ||
        [...adStorageQueryKeys, "fbc", "fbp"].some((key) => scope[key])))
  ) {
    return null;
  }
  const verification =
    eventType === "source_touch"
      ? normalizeInstallationVerification(input.verification)
      : null;
  return {
    schemaVersion: BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION,
    eventId,
    eventType,
    occurredAt,
    ...(journeyId ? { journeyId } : {}),
    journeyIdentityScope,
    collectionPostureObservation,
    ...(verification ? { verification } : {}),
    scope,
  };
};

export async function parse(
  request: Request,
  options: ParseOptions = {},
): Promise<CollectBody | null> {
  const maxBytes = options.maxBytes ?? 16_384;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return null;
  try {
    return normalizeBody(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function acceptScope(scope: Scope, evidence: Evidence): Scope | null {
  const siteOrigin = canonicalOrigin(evidence.siteUrl);
  const currentOrigin = origin(scope.current_url);
  const requestOrigin = canonicalOrigin(evidence.requestOrigin);
  if (
    !siteOrigin ||
    !currentOrigin ||
    currentOrigin !== siteOrigin ||
    !requestOrigin ||
    requestOrigin !== siteOrigin
  ) {
    return null;
  }
  const accepted = canonicalizeCurrentUrl({ ...scope });
  const userAgent = clean(evidence.userAgent, 2048);
  if (userAgent) accepted.client_user_agent = userAgent;
  else delete accepted.client_user_agent;
  return accepted;
}
