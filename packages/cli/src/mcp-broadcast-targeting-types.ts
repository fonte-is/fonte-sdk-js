import { z } from "zod";

import { broadcastDraftSnapshotSchema } from "./mcp-broadcast-draft-revision-types.js";
import {
  mcpOperationIdSchema,
  mcpOutcomeSchema,
  mcpRevisionSchema,
  mcpWorkspaceSchema,
} from "./mcp-broadcast-render-types.js";

const canonicalUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const referenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("system"), systemId: canonicalUuid }).strict(),
  z
    .object({ kind: z.literal("one_time"), oneTimeSetId: canonicalUuid })
    .strict(),
  z
    .object({
      kind: z.literal("contact"),
      contactId: z
        .string()
        .min(1)
        .max(200)
        .refine((value) => value === value.trim() && !/\p{Cc}/u.test(value)),
    })
    .strict(),
  z
    .object({
      kind: z.literal("email_domain"),
      domain: z.string().max(253).refine(canonicalDomain),
    })
    .strict(),
  z
    .object({ kind: z.literal("collection"), collectionId: canonicalUuid })
    .strict(),
  z
    .object({
      kind: z.literal("import_batch"),
      contactImportBatchId: canonicalUuid,
    })
    .strict(),
]);
const referencesSchema = z
  .array(referenceSchema)
  .max(100)
  .refine((items) => new Set(items.map(referenceKey)).size === items.length, {
    message: "target references must be unique",
  });
export const broadcastRecipientSelectionSchema = z
  .object({
    to: z.union([
      z.object({ kind: z.literal("everyone") }).strict(),
      z
        .object({
          kind: z.literal("selected"),
          references: referencesSchema,
        })
        .strict(),
    ]),
    except: referencesSchema,
  })
  .strict()
  .refine(
    (value) => {
      if (value.to.kind === "everyone") return true;
      const included = new Set(value.to.references.map(referenceKey));
      return !value.except.some((item) => included.has(referenceKey(item)));
    },
    { message: "target cannot also be excluded" },
  );

export const updateBroadcastTargetingInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    base_revision: mcpRevisionSchema,
    operation_id: mcpOperationIdSchema,
    recipient_selection: broadcastRecipientSelectionSchema.nullable(),
  })
  .strict();

const targetingResultSchema = z
  .object({
    kind: z.literal("broadcast_targeting_revision"),
    draft_id: z.string().uuid(),
    base_revision: mcpRevisionSchema,
    revision: mcpRevisionSchema,
    operation_id: mcpOperationIdSchema,
    saved_at: z.string().min(1),
    recipient_selection: broadcastRecipientSelectionSchema.nullable(),
    draft: broadcastDraftSnapshotSchema,
  })
  .strict();

export const updateBroadcastTargetingOutputSchema = z
  .object({
    outcome: mcpOutcomeSchema,
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    targeting: targetingResultSchema.nullable(),
  })
  .strict();

function referenceKey(value: z.infer<typeof referenceSchema>): string {
  if (value.kind === "system") return `system:${value.systemId}`;
  if (value.kind === "one_time") return `one_time:${value.oneTimeSetId}`;
  if (value.kind === "contact") return `contact:${value.contactId}`;
  if (value.kind === "email_domain") return `email_domain:${value.domain}`;
  if (value.kind === "collection") return `collection:${value.collectionId}`;
  return `import_batch:${value.contactImportBatchId}`;
}

function canonicalDomain(value: string): boolean {
  return (
    value === value.trim().toLowerCase() &&
    value.includes(".") &&
    value
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  );
}
