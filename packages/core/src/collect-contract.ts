import type { Scope } from "./types.js";

export const measurementQueryKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export const adStorageQueryKeys = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid",
] as const;

export const paidMediums = new Set([
  "cpc",
  "ppc",
  "paid",
  "paid_search",
  "paid_social",
  "display",
  "affiliate",
]);

export const scopeKeys = new Set([
  "current_url",
  "canonical_route",
  "referrer",
  "client_user_agent",
  "fonte",
  ...measurementQueryKeys,
  ...adStorageQueryKeys,
  "fbc",
  "fbp",
  "fonte_device_id",
  "fonte_journey_id",
]);

export const clean = (value: unknown, maxLength = 2048): string =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, maxLength)
    : "";

export function canonicalizePageUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return new URL(`${parsed.origin}${parsed.pathname}`).href;
  } catch {
    return "";
  }
}

export function canonicalizeCurrentUrl(scope: Scope): Scope {
  if (!scope.current_url) return scope;
  const currentUrl = canonicalizePageUrl(scope.current_url);
  return currentUrl ? { ...scope, current_url: currentUrl } : scope;
}
