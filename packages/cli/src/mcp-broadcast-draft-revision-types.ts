import { z } from "zod";

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
const nullableCopy = (maximum: number, allowEmpty: boolean) =>
  z.union([
    z.null(),
    z
      .string()
      .max(maximum)
      .refine((value) => allowEmpty || value.length > 0)
      .refine((value) => !/\p{Cc}/u.test(value)),
  ]);

const copyChangesSchema = z
  .object({
    title: nullableCopy(100, false).optional(),
    subject: nullableCopy(998, true).optional(),
    preheader: nullableCopy(500, true).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one copy change is required",
  });

export const reviseBroadcastDraftInputSchema = z
  .object({
    workspace: workspaceSchema,
    draft_id: z.string().uuid(),
    base_revision: revisionSchema,
    operation_id: operationIdSchema,
    changes: copyChangesSchema,
  })
  .strict();

const revisionResultSchema = z
  .object({
    kind: z.literal("broadcast_draft_revision"),
    draft_id: z.string().uuid(),
    base_revision: revisionSchema,
    revision: revisionSchema,
    operation_id: operationIdSchema,
    saved_at: z.string().min(1),
    changes: copyChangesSchema,
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
    revision: revisionResultSchema.nullable(),
  })
  .strict();
