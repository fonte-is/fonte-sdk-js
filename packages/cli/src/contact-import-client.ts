import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { contactImportStatus } from "./contact-import-json.js";
import type {
  ContactImportStatusInput,
  ContactImportStatusResult,
} from "./contact-import-types.js";

export interface ContactImportClient {
  readContactImportStatus(
    input: ContactImportStatusInput,
  ): Promise<ContactImportStatusResult>;
}

export const contactImportStatusInputSchema = z.strictObject({
  workspace: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/)
    .refine((value) => !value.includes("--")),
  environment: z.enum(["sandbox", "production"]),
  contactImportBatchId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
});

export function createContactImportClient(
  request: CoreRequester,
): ContactImportClient {
  return {
    async readContactImportStatus(input) {
      const parsed = contactImportStatusInputSchema.safeParse(input);
      if (!parsed.success)
        throw new CoreOperatorError(
          "contact_import_request_invalid",
          null,
          "none",
        );
      input = parsed.data;
      const result = parseCoreReceipt(
        contactImportStatus,
        await request("/v1/broadcast-email/contact-imports", {
          body: {
            workspaceSlug: input.workspace,
            environment: input.environment,
            contactImportBatchId: input.contactImportBatchId,
          },
          lostResponseEffect: "none",
        }),
      );
      if (
        result.environment !== input.environment ||
        result.contact_import_batch_id !==
          input.contactImportBatchId.toLowerCase()
      ) {
        throw new CoreOperatorError(
          "core_operator_receipt_invalid",
          null,
          "none",
        );
      }
      return result;
    },
  };
}
import { z } from "zod";
