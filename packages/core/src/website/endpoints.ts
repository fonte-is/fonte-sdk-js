import { WebsiteConfigurationError } from "./contract.js";
import { validSiteId } from "./settings.js";

declare const __FONTE_WEBSITE_CDN_ORIGIN__: string;
declare const __FONTE_WEBSITE_API_ORIGIN__: string;
declare const __FONTE_WEBSITE_RELEASE__: string;

// Only the ordinary build can replace these constants for declared local fixtures.
export const WEBSITE_CDN_ORIGIN =
  typeof __FONTE_WEBSITE_CDN_ORIGIN__ === "string"
    ? __FONTE_WEBSITE_CDN_ORIGIN__
    : "https://cdn.fonte.is";
export const WEBSITE_API_ORIGIN =
  typeof __FONTE_WEBSITE_API_ORIGIN__ === "string"
    ? __FONTE_WEBSITE_API_ORIGIN__
    : "https://api.fonte.is";
export const WEBSITE_RELEASE =
  typeof __FONTE_WEBSITE_RELEASE__ === "string"
    ? __FONTE_WEBSITE_RELEASE__
    : "unbuilt";
export const websiteStylesheetUrl = `${WEBSITE_CDN_ORIGIN}/website/${WEBSITE_RELEASE}/forms.css`;
export const validWebsiteUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export function websiteEndpoints(siteId: string) {
  if (!validSiteId(siteId)) throw new WebsiteConfigurationError("siteId");
  const base = `/v1/websites/${siteId}`;
  return {
    settings: `${WEBSITE_CDN_ORIGIN}${base}/settings`,
    observations: `${WEBSITE_API_ORIGIN}${base}/observations`,
    submission(publicId: string) {
      if (!validWebsiteUuid(publicId))
        throw new WebsiteConfigurationError("publicId");
      return `${WEBSITE_API_ORIGIN}${base}/forms/${publicId}/submissions`;
    },
  };
}
