import { measurementQueryKeys } from "../collect-contract.js";
import type { CollectionPolicy } from "../collection-policy.js";
import {
  WebsiteConfigurationError,
  type PublicWebsiteFormV1,
  type SiteSettingsV1,
  type WebsitePlacementV1,
} from "./contract.js";

export const MAX_SETTINGS_BYTES = 256 * 1024;
export const validSiteId = (value: unknown): value is string =>
  typeof value === "string" && /^site_[a-zA-Z0-9_-]{16,80}$/.test(value);
const fail = (field: string): never => {
  throw new WebsiteConfigurationError(field);
};
const object = (value: unknown, field: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(field);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const text = (value: unknown, field: string, cap: number): string => {
  if (
    typeof value !== "string" ||
    bytes(value) > cap ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      value,
    )
  )
    fail(field);
  return value as string;
};
const boolean = (value: unknown, field: string): boolean =>
  typeof value === "boolean" ? value : fail(field);
const revision = (value: unknown, field: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail(field);
const list = (value: unknown, field: string, cap: number): unknown[] =>
  Array.isArray(value) && value.length <= cap ? value : fail(field);
const path = (value: unknown, field: string): string => {
  if (
    typeof value !== "string" ||
    !(value === "*" || /^\/[a-zA-Z0-9_/-]{0,199}(?:\/\*)?$/.test(value))
  )
    fail(field);
  return value as string;
};
export function parseWebsiteOrigin(value: unknown): string {
  const raw = text(value, "origins", 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("origins");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    /[@*\s]/.test(raw) ||
    raw.includes("\\") ||
    raw.includes("?") ||
    raw.includes("#") ||
    !/^https?:\/\/[^/]+\/?$/i.test(raw) ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    return fail("origins");
  const authority = raw.slice(raw.indexOf("://") + 3).replace(/\/$/, "");
  const literalHost = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0].toLowerCase();
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(literalHost)
  )
    fail("origins");
  return url.origin;
}
function policy(value: unknown): Omit<CollectionPolicy, "status"> | null {
  if (value === null) return null;
  const p = object(value, "collection.policy");
  if (
    typeof p.version !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,120}$/.test(p.version)
  )
    fail("policy.version");
  if (!(
    p.expiresAt === null ||
    (typeof p.expiresAt === "number" && Number.isFinite(p.expiresAt))
  ))
    fail("policy.expiresAt");
  if (!(p.storage === "memory" || p.storage === "persistent"))
    fail("policy.storage");
  const result: Omit<CollectionPolicy, "status"> = {
    version: p.version as string,
    expiresAt: p.expiresAt as number | null,
    storage: p.storage as "memory" | "persistent",
    routes: list(p.routes, "policy.routes", 32).map((v) =>
      path(v, "policy.routes"),
    ),
  };
  for (const key of ["clickIds", "adCookies", "sourceTokens"] as const)
    if (p[key] !== undefined) result[key] = boolean(p[key], `policy.${key}`);
  if (p.campaignValues === true) result.campaignValues = true;
  else if (p.campaignValues !== undefined) {
    const campaigns = object(p.campaignValues, "policy.campaignValues");
    const selected: Exclude<
      CollectionPolicy["campaignValues"],
      true | undefined
    > = {};
    for (const [key, value] of Object.entries(campaigns)) {
      if (!measurementQueryKeys.some((allowed) => allowed === key))
        fail("policy.campaignValues");
      const values = list(value, "policy.campaignValues", 64).map((v) => {
        if (typeof v !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(v))
          fail("policy.campaignValues");
        return v as string;
      });
      selected[key as (typeof measurementQueryKeys)[number]] = values;
    }
    result.campaignValues = selected;
  }
  // A status in public settings cannot override runtime-owned consent.
  if (p.status !== undefined) fail("policy.status");
  return result;
}
function form(value: unknown): PublicWebsiteFormV1 {
  const f = object(value, "form");
  if (
    typeof f.publicId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      f.publicId,
    )
  )
    fail("form.publicId");
  if (!(
    f.confirmation === "single_opt_in" || f.confirmation === "double_opt_in"
  ))
    fail("form.confirmation");
  const result: PublicWebsiteFormV1 = {
    publicId: f.publicId as string,
    publishedRevision: revision(f.publishedRevision, "form.publishedRevision"),
    headline: text(f.headline, "form.headline", 512),
    description: text(f.description, "form.description", 8 * 1024),
    submitLabel: text(f.submitLabel, "form.submitLabel", 512),
    successMessage: text(f.successMessage, "form.successMessage", 8 * 1024),
    firstNameEnabled: boolean(f.firstNameEnabled, "form.firstNameEnabled"),
    confirmation: f.confirmation as PublicWebsiteFormV1["confirmation"],
    scopeLabel: text(f.scopeLabel, "form.scopeLabel", 512),
  };
  if (bytes(JSON.stringify(result)) > 24 * 1024) fail("form.bytes");
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
/** Validate atomically and retain only the known published public projection. */
export function parseSiteSettings(
  value: unknown,
  expectedSiteId: string,
): SiteSettingsV1 {
  const s = object(value, "settings");
  if (!validSiteId(expectedSiteId) || s.siteId !== expectedSiteId)
    fail("siteId");
  if (s.schema !== "fonte.website.v1") fail("schema");
  const c = object(s.collection, "collection");
  if (!(c.mode === "off" || c.mode === "automatic" || c.mode === "opt_in"))
    fail("collection.mode");
  const keys = new Set<string>();
  const placements: WebsitePlacementV1[] = list(
    s.placements,
    "placements",
    10,
  ).map((value) => {
    const p = object(value, "placement");
    if (
      typeof p.key !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(p.key) ||
      keys.has(p.key)
    )
      fail("placement.key");
    keys.add(p.key as string);
    if (!(
      p.presentation === "inline" ||
      p.presentation === "popup" ||
      p.presentation === "slide_in"
    ))
      fail("placement.presentation");
    return {
      key: p.key as string,
      presentation: p.presentation as WebsitePlacementV1["presentation"],
      paths: list(p.paths, "placement.paths", 32).map((v) =>
        path(v, "placement.paths"),
      ),
      form: form(p.form),
    };
  });
  const origins = list(s.origins, "origins", 32).map(parseWebsiteOrigin);
  if (new Set(origins).size !== origins.length) fail("origins");
  const result: SiteSettingsV1 = {
    schema: "fonte.website.v1",
    siteId: expectedSiteId,
    revision: revision(s.revision, "revision"),
    enabled: boolean(s.enabled, "enabled"),
    origins,
    collection: {
      mode: c.mode as SiteSettingsV1["collection"]["mode"],
      policy: policy(c.policy),
    },
    placements,
  };
  if (bytes(JSON.stringify(result)) > MAX_SETTINGS_BYTES)
    fail("settings.bytes");
  return freeze(result);
}
