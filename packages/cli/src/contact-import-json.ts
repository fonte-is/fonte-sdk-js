import { object, sha256, uuid } from "./operator-json.js";
import type { ContactImportStatusResult } from "./contact-import-types.js";

export function contactImportStatus(value: unknown): ContactImportStatusResult {
  const body = object(value);
  uuid(body.tenantId);
  const environment = body.environment;
  if (
    (environment !== "sandbox" && environment !== "production") ||
    body.status !== "completed"
  ) {
    throw new TypeError("core_operator_receipt_invalid");
  }
  return {
    kind: "contact_import_status",
    environment,
    status: "completed",
    contact_import_batch_id: uuid(body.contactImportBatchId),
    identity_set_sha256: sha256(body.identitySetSha256),
  };
}
