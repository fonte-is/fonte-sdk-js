import { createClientAttemptId } from "./ids.js";
import {
  adStorageQueryKeys,
  canonicalizeCurrentUrl,
  clean,
  measurementQueryKeys,
} from "./collect-contract.js";
import type { Scope } from "./types.js";

export const compactScope = (value: unknown): Scope | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries: Array<[string, string]> = [];
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = clean(key, 120);
    const normalizedValue = clean(entry);
    if (normalizedKey && normalizedValue) {
      entries.push([normalizedKey, normalizedValue]);
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

const readCookie = (name: string): string => {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const candidate = part.trim();
    if (!candidate.startsWith(prefix)) continue;
    try {
      return clean(decodeURIComponent(candidate.slice(prefix.length)), 500);
    } catch {
      return "";
    }
  }
  return "";
};

const readOrCreateId = (key: string): string => {
  if (typeof window === "undefined") return "";
  try {
    const existing = clean(window.localStorage.getItem(key), 80);
    if (existing) return existing;
    const created = createClientAttemptId();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return createClientAttemptId();
  }
};

interface ScopeReaderConfig {
  deviceStorageKey: string;
  journeyStorageKey: string;
}

export function createScopeReader(
  config: ScopeReaderConfig,
): () => Scope | null {
  return () => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return null;
    }
    const sourceUrl = new URL(window.location.href);
    const scope: Scope = {
      current_url: sourceUrl.href,
      canonical_route: window.location.pathname,
    };

    const fonteToken = clean(sourceUrl.searchParams.get("fonte"), 500);
    if (fonteToken) scope.fonte = fonteToken;
    if (document.referrer) scope.referrer = clean(document.referrer);

    scope.fonte_device_id = readOrCreateId(config.deviceStorageKey);
    scope.fonte_journey_id = readOrCreateId(config.journeyStorageKey);
    for (const key of measurementQueryKeys) {
      const value = clean(sourceUrl.searchParams.get(key), 500);
      if (value) scope[key] = value;
    }

    for (const key of adStorageQueryKeys) {
      const value = clean(sourceUrl.searchParams.get(key), 500);
      if (value) scope[key] = value;
    }
    for (const [scopeKey, cookieName] of [
      ["fbc", "_fbc"],
      ["fbp", "_fbp"],
    ] as const) {
      const value = readCookie(cookieName);
      if (value) scope[scopeKey] = value;
    }

    return compactScope(canonicalizeCurrentUrl(scope));
  };
}
