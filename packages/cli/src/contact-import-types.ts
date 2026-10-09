export interface ContactImportStatusInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly contactImportBatchId: string;
}

export interface ContactImportStatusResult {
  readonly kind: "contact_import_status";
  readonly environment: "sandbox" | "production";
  readonly status: "completed";
  readonly contact_import_batch_id: string;
  readonly identity_set_sha256: string;
}

export type ContactImportOperatorCommand = {
  readonly kind: "bridge_contact_import_status";
} & ContactImportStatusInput;
