import type { CollectionPolicy } from "../collection-policy.js";

export type SiteId = string;
export interface PublicWebsiteFormV1 {
  publicId: string;
  publishedRevision: number;
  headline: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  firstNameEnabled: boolean;
  confirmation: "single_opt_in" | "double_opt_in";
  scopeLabel: string;
}
export interface WebsitePlacementV1 {
  key: string;
  presentation: "inline" | "popup" | "slide_in";
  paths: string[];
  form: PublicWebsiteFormV1;
}
export interface SiteSettingsV1 {
  schema: "fonte.website.v1";
  siteId: SiteId;
  revision: number;
  enabled: boolean;
  origins: string[];
  collection: {
    mode: "off" | "automatic" | "opt_in";
    policy: Omit<CollectionPolicy, "status"> | null;
  };
  placements: WebsitePlacementV1[];
}
export interface WebsiteStatus {
  siteId: string;
  runtimeVersion: string;
  settingsRevision: number | null;
  state: "loading" | "ready" | "unavailable" | "disabled" | "conflict";
  collection: "off" | "unknown" | "enabled" | "denied" | "unavailable";
  forms: { mounted: number; unavailable: number };
}
export interface WebsiteRuntime {
  getStatus(): WebsiteStatus;
  setConsent(status: "granted" | "denied" | "unknown"): void;
  refresh(): Promise<void>;
  destroy(): void;
}

/** Local configuration errors never contain the rejected public payload. */
export class WebsiteConfigurationError extends Error {
  readonly code = "invalid_website_configuration";
  constructor(readonly field: string) {
    super(`Invalid website configuration: ${field}`);
    this.name = "WebsiteConfigurationError";
  }
}
