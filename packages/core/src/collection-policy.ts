import type { Scope } from "./types.js";
import { measurementQueryKeys } from "./collect-contract.js";
import {
  normalizeSourceEvidence,
  validSourceFields,
  type SourceEvidence,
  type SourceFields,
} from "./source-evidence.js";

/** Installation policy input, never evidence of legal consent by itself. */
export interface CollectionPolicy {
  status: "granted" | "denied" | "unknown";
  version: string;
  expiresAt: number | null;
  storage: "memory" | "persistent";
  routes: readonly string[];
  clickIds?: boolean;
  adCookies?: boolean;
  sourceTokens?: boolean;
  sourceFields?: SourceFields;
  campaignValues?:
    | true
    | Partial<Record<(typeof measurementQueryKeys)[number], readonly string[]>>;
}
export function permitted(
  policy: CollectionPolicy | null | undefined,
): policy is CollectionPolicy {
  return Boolean(
    policy &&
    policy.status === "granted" &&
    typeof policy.version === "string" &&
    /^[a-zA-Z0-9_.:-]{1,120}$/.test(policy.version) &&
    (policy.expiresAt === null ||
      (Number.isFinite(policy.expiresAt) && policy.expiresAt > Date.now())) &&
    ["memory", "persistent"].includes(policy.storage) &&
    Array.isArray(policy.routes) &&
    policy.routes.length <= 32 &&
    policy.routes.every(
      (route) =>
        typeof route === "string" &&
        (route === "*" || /^\/[a-zA-Z0-9_/-]{0,199}(?:\/\*)?$/.test(route)),
    ) &&
    [policy.clickIds, policy.adCookies, policy.sourceTokens].every(
      (value) => value === undefined || typeof value === "boolean",
    ) &&
    validCampaignValues(policy.campaignValues) &&
    (policy.sourceFields === undefined ||
      validSourceFields(policy.sourceFields)) &&
    (!policy.clickIds || Boolean(policy.sourceFields?.query.length)) &&
    (!policy.adCookies || Boolean(policy.sourceFields?.cookies.length)),
  );
}
function validCampaignValues(value: CollectionPolicy["campaignValues"]) {
  if (value === undefined || value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, values]) =>
      measurementQueryKeys.some((allowed) => allowed === key) &&
      Array.isArray(values) &&
      values.length <= 64 &&
      values.every(
        (item) =>
          typeof item === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(item),
      ),
  );
}
const identifier = (value: string | undefined): string | undefined =>
  value && /^[a-zA-Z0-9_.~-]{1,500}$/.test(value) ? value : undefined;
/** The same minimization runs before browser transmission and server admission. */
export function minimizeScope(
  scope: Scope,
  policy: CollectionPolicy,
): Scope | null {
  let url: URL;
  try {
    url = new URL(scope.current_url);
  } catch {
    return null;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !routePermitted(url.pathname, policy)
  )
    return null;
  const result: Scope = {
    current_url: `${url.origin}${url.pathname}`,
    canonical_route: url.pathname,
  };
  for (const key of ["fonte_device_id", "fonte_journey_id"]) {
    const value = scope[key];
    if (value && /^[0-9a-f-]{36}$/i.test(value)) result[key] = value;
  }
  try {
    const referrer = new URL(scope.referrer);
    if (["https:", "http:"].includes(referrer.protocol))
      result.referrer = referrer.origin;
  } catch {
    /* absent remains unknown */
  }
  for (const key of measurementQueryKeys) {
    if (
      scope[key] &&
      (policy.campaignValues === true ||
        policy.campaignValues?.[key]?.includes(scope[key]))
    )
      result[key] = scope[key];
  }
  if (policy.sourceTokens) {
    const value = identifier(scope.fonte);
    if (value) result.fonte = value;
    const click = scope.fonte_click;
    if (
      value &&
      click &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        click,
      )
    )
      result.fonte_click = click.toLowerCase();
  }
  return result;
}

export function routePermitted(
  path: string,
  policy: CollectionPolicy,
): boolean {
  return policy.routes.some(
    (route) =>
      route === "*" ||
      (route.endsWith("/*")
        ? path.startsWith(route.slice(0, -1))
        : route === path),
  );
}

export function minimizeSourceEvidence(
  value: unknown,
  policy: CollectionPolicy,
): SourceEvidence | null {
  if (!permitted(policy)) return null;
  const evidence = normalizeSourceEvidence(value);
  if (!evidence) return null;
  return {
    query: policy.clickIds
      ? evidence.query.filter((entry) =>
          policy.sourceFields!.query.includes(entry.name),
        )
      : [],
    cookies: policy.adCookies
      ? evidence.cookies.filter((entry) =>
          policy.sourceFields!.cookies.includes(entry.name),
        )
      : [],
  };
}
