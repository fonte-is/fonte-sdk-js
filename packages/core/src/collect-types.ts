import type { InstallationVerificationMetadata } from "./installation-verification.js";
import type { Scope } from "./types.js";
import type { SourceEvidence } from "./source-evidence.js";

export interface Evidence {
  siteUrl: string | null | undefined;
  requestOrigin: string | null;
  userAgent?: string | null;
}

export type CollectEventType = "page_view" | "source_touch" | "browser_landing";

/** Reported browser evidence; it establishes neither a person nor inbox delivery. */
export type BrowserLandingEvidence = Readonly<{
  version: "interaction.v1";
  visibility: "visible";
  interaction: "pointerdown" | "keydown" | "touchstart";
}>;

export interface CollectBody {
  schemaVersion: "fonte.acquisition.v2";
  occurrenceId: string;
  occurredAt: string;
  collectionVersion: string;
  eventId: string;
  eventType: CollectEventType;
  journeyId: string;
  verification?: InstallationVerificationMetadata;
  pageEventId?: string;
  browserEvidence?: BrowserLandingEvidence;
  scope: Scope;
  sourceEvidence: SourceEvidence;
}

export interface ParseOptions {
  maxBytes?: number;
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
