export type Scope = Record<string, string>;

export interface WriteResult {
  blocked?: boolean;
  reason?: "visitor_choice_denies" | "collection_policy_withholds";
  skipped?: string;
  recordId?: string;
  logicalEventId?: string;
  entityId?: string;
  deduplicated?: boolean;
  firstEvidenceReceiptId?: string;
}
