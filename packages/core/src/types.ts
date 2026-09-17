export type Scope = Record<string, string>;

export interface WriteResult {
  disposition?:
    | "accepted"
    | "duplicate_of_accepted"
    | "ignored"
    | "rejected"
    | "unavailable";
  receivedAt?: string;
  skipped?: string;
  recordId?: string;
  logicalEventId?: string;
  entityId?: string;
  deduplicated?: boolean;
  firstEvidenceReceiptId?: string;
}
