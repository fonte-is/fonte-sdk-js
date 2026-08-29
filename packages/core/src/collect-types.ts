import type { InstallationVerificationMetadata } from "./installation-verification.js";
import type { CollectionPostureObservation } from "./collection-posture.js";
import type { Scope } from "./types.js";

export const BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION =
  "fonte.browser_touch_observation.v1";

export interface Evidence {
  siteUrl: string | null | undefined;
  requestOrigin: string | null;
  userAgent?: string | null;
}

export type CollectEventType = "page_view" | "source_touch";
export type JourneyIdentityScope = "persistent_first_party" | "event_ephemeral";

export interface CollectBody {
  schemaVersion: typeof BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION;
  eventId: string;
  eventType: CollectEventType;
  occurredAt: string;
  journeyId?: string;
  journeyIdentityScope: JourneyIdentityScope;
  collectionPostureObservation: CollectionPostureObservation;
  verification?: InstallationVerificationMetadata;
  scope: Scope;
}

export interface ParseOptions {
  maxBytes?: number;
}

export interface SourceTouchClassification {
  channelType: "paid" | "owned" | "organic" | "referral" | "direct" | "unknown";
  channel:
    | "paid_search"
    | "paid_social"
    | "owned_email"
    | "owned_sms"
    | "organic_search"
    | "organic_social"
    | "referral"
    | "direct"
    | "unknown";
  sourcePlatform: string;
  captureReason:
    | "fonte_source_identity"
    | "platform_click_id"
    | "platform_cookie_signal"
    | "utm_parameter"
    | "external_referrer"
    | "internal_navigation"
    | "direct_landing"
    | "unknown";
}

export interface TouchPayload {
  journeyId?: string;
  journeyIdentityScope: JourneyIdentityScope;
  platform: "meta" | "google" | "other";
  isPaid: boolean;
  fonteLinkToken?: string;
  channelType?: SourceTouchClassification["channelType"];
  sourcePlatform?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  landingUrl?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  clientUserAgent?: string;
}
