export type Scope = Record<string, string>;

export interface WriteResult {
  skipped?: string;
  recordId?: string;
  logicalEventId?: string;
  entityId?: string;
  deduplicated?: boolean;
  firstEvidenceReceiptId?: string;
}
