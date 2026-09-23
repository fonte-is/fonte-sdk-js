import { z } from "zod";

import type { BroadcastDraftJsonValue } from "./operator-broadcast-draft-snapshot.js";

const outcomeSchema = z.enum([
  "completed",
  "unavailable",
  "denied",
  "conflict",
  "ambiguous",
]);
const workspaceSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/);
const operationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value),
  );
const revisionSchema = z.number().int().positive().safe();
const nullableHeader = (maximum: number, allowEmpty: boolean) =>
  z.union([
    z.null(),
    z
      .string()
      .max(maximum)
      .refine((value) => allowEmpty || value.length > 0)
      .refine((value) => !/\p{Cc}/u.test(value)),
  ]);
const nullableBody = z.union([
  z.null(),
  z
    .string()
    .refine((value) => new TextEncoder().encode(value).byteLength <= 262_144)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
    ),
]);

const revisionChangesSchema = z
  .object({
    title: nullableHeader(100, false).optional(),
    subject: nullableHeader(998, true).optional(),
    preheader: nullableHeader(500, true).optional(),
    text_body: nullableBody.optional(),
    active_source: z.enum(["composer", "html"]).optional(),
    composer_body: nullableBody.optional(),
    html_body: nullableBody.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one draft change is required",
  })
  .refine(
    (value) =>
      value.text_body === undefined ||
      (value.active_source === undefined &&
        value.composer_body === undefined &&
        value.html_body === undefined),
    { message: "text_body cannot be mixed with source fields" },
  );

export const reviseBroadcastDraftInputSchema = z
  .object({
    workspace: workspaceSchema,
    draft_id: z.string().uuid(),
    base_revision: revisionSchema,
    operation_id: operationIdSchema,
    changes: revisionChangesSchema,
  })
  .strict();

const jsonValueSchema: z.ZodType<BroadcastDraftJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const nullableTextSchema = z.string().nullable();
export const broadcastDraftSnapshotSchema = z
  .object({
    draft_id: z.string().uuid(),
    revision: revisionSchema,
    source_campaign_id: nullableTextSchema,
    source_broadcast_id: nullableTextSchema,
    title: nullableTextSchema,
    sender_profile_id: nullableTextSchema,
    reply_to: nullableTextSchema,
    audience_kind: z
      .enum(["all_contacts", "contact_import", "recipient_expression"])
      .nullable(),
    audience_contact_import_batch_id: nullableTextSchema,
    recipient_expression: jsonValueSchema,
    recipient_selection: jsonValueSchema,
    communication_purpose_id: nullableTextSchema,
    communication_purpose_name: nullableTextSchema,
    subject: nullableTextSchema,
    preheader: nullableTextSchema,
    text_body: nullableTextSchema,
    active_source: z.enum(["composer", "html"]),
    composer_body: nullableTextSchema,
    html_body: nullableTextSchema,
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();
export const broadcastDraftRevisionResultSchema = z
  .object({
    kind: z.literal("broadcast_draft_revision"),
    draft_id: z.string().uuid(),
    base_revision: revisionSchema,
    revision: revisionSchema,
    operation_id: operationIdSchema,
    saved_at: z.string().min(1),
    draft: broadcastDraftSnapshotSchema,
  })
  .strict();

export const reviseBroadcastDraftOutputSchema = z
  .object({
    outcome: outcomeSchema,
    reason: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/)
      .nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    revision: broadcastDraftRevisionResultSchema.nullable(),
  })
  .strict();
