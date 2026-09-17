import type { InstallationVerificationMetadata } from "./installation-verification.js";
import type { Scope } from "./types.js";

export interface Evidence {
  siteUrl: string | null | undefined;
  requestOrigin: string | null;
  userAgent?: string | null;
}

export type CollectEventType = "page_view" | "source_touch";

export interface CollectBody {
  schemaVersion: "fonte.acquisition.v1";
  occurrenceId: string;
  occurredAt: string;
  collectionVersion: string;
  classifierVersion: "source.v2";
  eventId: string;
  eventType: CollectEventType;
  journeyId: string;
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
    | "no_referrer"
    | "unknown";
}

export interface TouchPayload {
  journeyId: string;
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
  twclid?: string;
  ttclid?: string;
  fbc?: string;
  fbp?: string;
  clientUserAgent?: string;
}

export interface CollectionReceipt {
  disposition:
    | "accepted"
    | "duplicate_of_accepted"
    | "ignored"
    | "rejected"
    | "unavailable";
  eventId: string;
  recordId?: string;
  receivedAt?: string;
}
