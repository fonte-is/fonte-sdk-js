import type { Scope } from "./types.js";

export const collectMaxBytes = 16_384;
export const scopeValueMaxBytes = 500;
export const scopeUrlMaxBytes = 2048;
export function withinUtf8Limit(value: string, limit: number): boolean {
  return (
    value.length <= limit && new TextEncoder().encode(value).length <= limit
  );
}
export function boundedScopeValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    withinUtf8Limit(value, scopeValueMaxBytes)
  );
}

export const measurementQueryKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export const scopeKeys = new Set([
  "current_url",
  "canonical_route",
  "referrer",
  "client_user_agent",
  "fonte",
  "fonte_click",
  ...measurementQueryKeys,
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
    for (const key of ["fonte", "fonte_click", ...measurementQueryKeys]) {
      if (scope[key] && source.searchParams.get(key) === scope[key])
        accepted.searchParams.set(key, scope[key]);
    }
    return { ...scope, current_url: accepted.href };
  } catch {
    return scope;
  }
}
