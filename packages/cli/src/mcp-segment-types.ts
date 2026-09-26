import { z } from "zod";
import type { SegmentJsonValue } from "./operator-segment-types.js";

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const environment = z.enum(["sandbox", "production"]);
const revision = z.number().int().positive().safe();
const title = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      value === value.trim() &&
      Array.from(value).length <= 100 &&
      !/[\u0000-\u001f\u007f]/u.test(value),
  );
const jsonValue: z.ZodType<SegmentJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const rule = z.record(z.string(), jsonValue).refine((value) => {
  const encoded = JSON.stringify(value);
  return encoded !== undefined && byteLengthAtMost(encoded, 64 * 1_024);
});
const segmentListItemSchema = z.strictObject({
  segmentId: uuid,
  revision,
  title,
  archived: z.boolean(),
  createdAt: z.string().datetime({ offset: false }),
  updatedAt: z.string().datetime({ offset: false }),
});
const segmentRevisionSchema = z.strictObject({
  segmentId: uuid,
  revision,
  title,
  rule,
  ruleDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  semanticsVersion: z.literal("native_rule.v1"),
  archived: z.boolean(),
  createdAt: z.string().datetime({ offset: false }),
  updatedAt: z.string().datetime({ offset: false }),
});
const segmentReceiptSchema = z.strictObject({
  operationId: uuid,
  commandKind: z.enum(["create", "update", "setArchived"]),
  segmentId: uuid,
  resultingRevision: revision,
  committedAt: z.string().datetime({ offset: false }),
});
const segmentListEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("native_segment.v1"),
  tenantId: z.string().min(1).max(500),
  environment,
  segments: z.array(segmentListItemSchema).max(50),
  nextCursor: z.string().max(2_048).nullable(),
});
const segmentReadEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("native_segment.v1"),
  tenantId: z.string().min(1).max(500),
  environment,
  segment: segmentRevisionSchema,
});
const segmentCommandEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("native_segment.v1"),
  tenantId: z.string().min(1).max(500),
  environment,
  segment: segmentRevisionSchema,
  receipt: segmentReceiptSchema,
  replayed: z.boolean(),
});

export const segmentScopeInputSchema = z.strictObject({
  workspace: z
    .string()
    .min(2)
    .max(63)
    .regex(/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/u),
  environment,
});

export const listSegmentsInputSchema = segmentScopeInputSchema
  .extend({
    limit: z.number().int().positive().max(50).optional(),
    cursor: z
      .string()
      .min(1)
      .refine((value) => byteLengthAtMost(value, 2_048))
      .optional(),
    includeArchived: z.boolean().optional(),
  })
  .strict();

export const readSegmentInputSchema = segmentScopeInputSchema
  .extend({
    segmentId: uuid,
    revision: revision.optional(),
  })
  .strict();

export const createSegmentInputSchema = segmentScopeInputSchema
  .extend({
    segmentId: uuid,
    operationId: uuid,
    title,
    rule,
  })
  .strict();

export const updateSegmentInputSchema = segmentScopeInputSchema
  .extend({
    segmentId: uuid,
    operationId: uuid,
    expectedRevision: revision,
    title,
    rule,
  })
  .strict();

export const setSegmentArchivedInputSchema = segmentScopeInputSchema
  .extend({
    segmentId: uuid,
    operationId: uuid,
    expectedRevision: revision,
    archived: z.boolean(),
  })
  .strict();

export const readSegmentCommandInputSchema = segmentScopeInputSchema
  .extend({
    operationId: uuid,
  })
  .strict();

const authoritySchema = z.strictObject({
  status: z.literal("current"),
  contract_id: z.literal("fonte.core.native_segment.v1"),
});
const nextActionSchema = z.strictObject({
  kind: z.literal("read_segment_command"),
  workspace: z.string().min(2).max(63),
  environment,
  operation_id: uuid,
  resource_id: uuid,
});

export const segmentOperatorReceiptSchema = z.strictObject({
  schema_version: z.literal("fonte.cli.operator_receipt.v1"),
  command: z.enum([
    "segment_list",
    "segment_read",
    "segment_create",
    "segment_update",
    "segment_archive",
    "segment_receipt",
  ]),
  outcome: z.enum(["completed", "blocked"]),
  reason: z.string().regex(/^[a-z0-9_]{1,100}$/u),
  workspace: z.string().min(2).max(63),
  authority: authoritySchema,
  core_effect: z.enum(["none", "created", "replaced", "unknown"]),
  next_action: nextActionSchema.optional(),
  result: z
    .union([
      segmentListEnvelopeSchema,
      segmentReadEnvelopeSchema,
      segmentCommandEnvelopeSchema,
    ])
    .nullable(),
});

export const segmentOperatorResultSchema = segmentOperatorReceiptSchema;

function byteLengthAtMost(value: string, maximum: number): boolean {
  return Buffer.byteLength(value, "utf8") <= maximum;
}
