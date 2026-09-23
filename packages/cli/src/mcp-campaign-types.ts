import { z } from "zod";

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
const description = z
  .string()
  .refine((value) => byteLengthAtMost(value, 4_096));
const cursor = z
  .string()
  .min(1)
  .refine((value) => byteLengthAtMost(value, 2_048));
const campaignConfigurationSchema = z.strictObject({
  workspaceId: z.string().min(1).max(500),
  environment,
  campaignId: uuid,
  revision,
  title,
  description,
  archived: z.boolean(),
  createdAt: z.string().datetime({ offset: false }),
  updatedAt: z.string().datetime({ offset: false }),
  scopeBindingStatus: z.literal("not_qualified"),
});
const campaignReceiptSchema = z.strictObject({
  operationId: uuid,
  commandKind: z.enum(["create", "update"]),
  campaignId: uuid,
  resultingRevision: revision,
  committedAt: z.string().datetime({ offset: false }),
});
const campaignListEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("campaign_configuration.v1"),
  tenantId: z.string().min(1).max(500),
  environment,
  configurations: z.array(campaignConfigurationSchema).max(50),
  nextCursor: cursor.nullable(),
});
const campaignReadEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("campaign_configuration.v1"),
  tenantId: z.string().min(1).max(500),
  environment,
  configuration: campaignConfigurationSchema,
});
const campaignCommandEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal("campaign_configuration.v1"),
  tenantId: z.string().min(1).max(500),
  environment,
  configuration: campaignConfigurationSchema,
  receipt: campaignReceiptSchema,
  replayed: z.boolean(),
});

export const campaignScopeInputSchema = z.strictObject({
  workspace: z
    .string()
    .min(2)
    .max(63)
    .regex(/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/u),
  environment,
});

export const listCampaignsInputSchema = campaignScopeInputSchema
  .extend({
    limit: z.number().int().positive().max(50).optional(),
    cursor: cursor.optional(),
    includeArchived: z.boolean().optional(),
  })
  .strict();

export const readCampaignInputSchema = campaignScopeInputSchema
  .extend({
    campaignId: uuid,
  })
  .strict();

export const createCampaignInputSchema = campaignScopeInputSchema
  .extend({
    campaignId: uuid,
    operationId: uuid,
    title,
    description: description.optional(),
  })
  .strict();

export const updateCampaignInputSchema = campaignScopeInputSchema
  .extend({
    campaignId: uuid,
    operationId: uuid,
    expectedRevision: revision,
    title,
    description,
    archived: z.boolean(),
  })
  .strict();

export const readCampaignCommandInputSchema = campaignScopeInputSchema
  .extend({
    operationId: uuid,
  })
  .strict();

const authoritySchema = z.strictObject({
  status: z.literal("current"),
  contract_id: z.literal("fonte.core.campaign_configuration.v1"),
});
const nextActionSchema = z.strictObject({
  kind: z.literal("read_campaign_command"),
  workspace: z.string().min(2).max(63),
  environment,
  operation_id: uuid,
  resource_id: uuid,
});

export const campaignOperatorReceiptSchema = z.strictObject({
  schema_version: z.literal("fonte.cli.operator_receipt.v1"),
  command: z.enum([
    "campaign_list",
    "campaign_read",
    "campaign_create",
    "campaign_update",
    "campaign_receipt",
  ]),
  outcome: z.enum(["completed", "blocked"]),
  reason: z.string().regex(/^[a-z0-9_]{1,100}$/u),
  workspace: z.string().min(2).max(63),
  authority: authoritySchema,
  core_effect: z.enum(["none", "created", "replaced", "unknown"]),
  next_action: nextActionSchema.optional(),
  result: z
    .union([
      campaignListEnvelopeSchema,
      campaignReadEnvelopeSchema,
      campaignCommandEnvelopeSchema,
    ])
    .nullable(),
});

export const campaignOperatorResultSchema = campaignOperatorReceiptSchema;

function byteLengthAtMost(value: string, maximum: number): boolean {
  return Buffer.byteLength(value, "utf8") <= maximum;
}
