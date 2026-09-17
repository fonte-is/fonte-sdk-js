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
  if (scope.referrer) {
    try {
      scope.referrer = new URL(scope.referrer).origin;
    } catch {
      delete scope.referrer;
    }
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
  if (
    input.schemaVersion !== "fonte.acquisition.v1" ||
    input.classifierVersion !== "source.v2" ||
    typeof input.occurrenceId !== "string" ||
    !uuidPattern.test(input.occurrenceId) ||
    typeof input.occurredAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.occurredAt) ||
    !Number.isFinite(Date.parse(input.occurredAt)) ||
    typeof input.collectionVersion !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,120}$/.test(input.collectionVersion)
  )
    return null;
  const verification =
    eventType === "source_touch"
      ? normalizeInstallationVerification(input.verification)
      : null;
  return {
    schemaVersion: "fonte.acquisition.v1",
    classifierVersion: "source.v2",
    occurrenceId: input.occurrenceId,
    occurredAt: input.occurredAt,
    collectionVersion: input.collectionVersion,
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
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 3000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) return null;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(buffer);
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
