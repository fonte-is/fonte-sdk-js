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

export function canonicalizeCurrentUrl(scope: Scope): Scope {
  if (!scope.current_url) return scope;
  try {
    const source = new URL(scope.current_url);
    const accepted = new URL(`${source.origin}${source.pathname}`);
    if (scope.fonte && source.searchParams.get("fonte") === scope.fonte) {
      accepted.searchParams.set("fonte", scope.fonte);
    }
    for (const key of measurementQueryKeys) {
      if (scope[key] && source.searchParams.get(key) === scope[key]) {
        accepted.searchParams.set(key, scope[key]);
      }
    }
    for (const key of adStorageQueryKeys) {
      if (scope[key] && source.searchParams.get(key) === scope[key]) {
        accepted.searchParams.set(key, scope[key]);
      }
    }
    return { ...scope, current_url: accepted.href };
  } catch {
    return scope;
  }
}
