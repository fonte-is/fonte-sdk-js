import {
  canonicalizeCurrentUrl,
  clean,
  scopeKeys,
} from "./collect-contract.js";
import type {
  CollectBody,
  CollectEventType,
  Evidence,
  ParseOptions,
} from "./collect-types.js";
import { normalizeInstallationVerification } from "./installation-verification.js";
import type { Scope } from "./types.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypes = new Set<CollectEventType>(["page_view", "source_touch"]);

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
  const scope: Scope = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!scopeKeys.has(key)) continue;
    const maxLength = key === "current_url" || key === "referrer" ? 2048 : 500;
    const normalized = clean(raw, maxLength);
    if (normalized) scope[key] = normalized;
  }
  return Object.keys(scope).length > 0 ? canonicalizeCurrentUrl(scope) : null;
};

const normalizeBody = (value: unknown): CollectBody | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const eventId = clean(input.eventId, 80).toLowerCase();
  const eventType = clean(input.eventType, 40) as CollectEventType;
  const journeyId = clean(input.journeyId, 80).toLowerCase();
  const scope = normalizeScope(input.scope);
  if (
    !uuidPattern.test(eventId) ||
    !eventTypes.has(eventType) ||
    !uuidPattern.test(journeyId) ||
    !scope ||
    scope.fonte_journey_id !== journeyId
  ) {
    return null;
  }
  const verification =
    eventType === "source_touch"
      ? normalizeInstallationVerification(input.verification)
      : null;
  return {
    eventId,
    eventType,
    journeyId,
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
