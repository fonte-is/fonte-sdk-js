import type { InstallationVerificationMetadata } from "./installation-verification.js";
import type { CollectionPolicy } from "./collection-policy.js";
import type { CollectBody, CollectionReceipt } from "./collect-types.js";
export type CaptureEventType = "page_view" | "source_touch";
export type CaptureDeliveryReason =
  | "browser_unavailable"
  | "missing_journey_id"
  | "duplicate"
  | "in_flight"
  | "not_source_touch"
  | "http_error"
  | "network_error"
  | "collection_not_permitted"
  | "route_not_permitted"
  | "receipt_unavailable"
  | "ignored"
  | "rejected"
  | "retry_exhausted"
  | "expired";
export interface CaptureDelivery {
  eventType: CaptureEventType;
  status: "delivered" | "skipped" | "failed";
  eventId?: string;
  occurrenceId?: string;
  reason?: CaptureDeliveryReason;
  httpStatus?: number;
  receipt?: CollectionReceipt;
}
export interface CapturePageResult {
  deliveries: CaptureDelivery[];
}
export interface CaptureConfig {
  storage: string;
  collect?: string;
  /** Absolute lifetime of browser continuity. Reads do not refresh it. */
  maxAgeDays?: number;
  verification?: InstallationVerificationMetadata;
  collectionPolicy?: () => CollectionPolicy | null;
  capturePolicy?: {
    mode?: "source_touch" | "all";
    captureDirectLanding?: boolean;
  };
  onDelivery?: (delivery: CaptureDelivery) => void;
  /** Sanitized observation, independent of Fonte delivery; does not assert custody. */
  onObservation?: (observation: CollectBody) => void;
}
export interface Capture {
  page(options?: { navigation?: boolean }): Promise<CapturePageResult>;
  retry(): Promise<CapturePageResult>;
  /** Clear local active identity and pending observations on logout/withdrawal. */
  reset(): void;
}
export type { CollectionPolicy } from "./collection-policy.js";
