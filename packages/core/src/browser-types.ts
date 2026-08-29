import type { InstallationVerificationMetadata } from "./installation-verification.js";
import type { BrowserCollectionPosture } from "./collection-posture.js";

export type CaptureEventType = "page_view" | "source_touch";

export type CaptureDeliveryReason =
  | "browser_unavailable"
  | "missing_journey_id"
  | "duplicate"
  | "in_flight"
  | "not_source_touch"
  | "collection_posture_unavailable"
  | "visitor_choice_unavailable"
  | "collection_policy_withholds"
  | "visitor_choice_denies"
  | "http_error"
  | "network_error";

export interface CaptureDelivery {
  eventType: CaptureEventType;
  status: "delivered" | "skipped" | "failed" | "unavailable" | "withheld";
  eventId?: string;
  reason?: CaptureDeliveryReason;
  httpStatus?: number;
}

export interface CapturePageResult {
  deliveries: CaptureDelivery[];
}

export interface CaptureConfig {
  storage: string;
  collect?: string;
  maxAgeDays?: number;
  verification?: InstallationVerificationMetadata;
  collectionPosture?: BrowserCollectionPosture;
  capturePolicy?: {
    mode?: "source_touch" | "all";
    captureDirectLanding?: boolean;
  };
  onDelivery?: (delivery: CaptureDelivery) => void;
}

export interface Capture {
  page(): Promise<CapturePageResult>;
  retry(): Promise<CapturePageResult>;
}
