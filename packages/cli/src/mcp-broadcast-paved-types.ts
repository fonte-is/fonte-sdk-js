import path from "node:path";
import { z } from "zod";

const uuid = z.string().uuid();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const instant = z.string().datetime({ offset: true });
const price = z.object({ priceVersion: z.string().min(1), currency: z.string().min(1),
  maximumUnitPriceMicros: z.string().regex(/^[0-9]+$/u) }).strict();
const reviewSchema = z.object({
  preparation: z.object({
    commandId: uuid, expectedDraftVersion: z.number().int().positive().safe(),
    audienceSnapshotId: z.string().min(1),
    purposePolicyGeneration: z.enum(["contacts_marketing_subscription.v1", "csv_marketing_local_baseline.v1"]),
    activeSource: z.enum(["composer", "html"]),
    clickTrackingEnabled: z.literal(true), engagementTrackingEnabled: z.literal(true),
    deliveryRequirements: z.object({
      geography: z.tuple([]), dataResidency: z.tuple([]), ipCommitment: z.literal("either"),
      maximumDeliveryDelaySeconds: z.literal(3600), excludedProviderIdentities: z.tuple([]),
      encryption: z.literal("tls_required"), loggingPolicy: z.literal("delivery_events_v1"),
      promisedProviderRouteVersion: z.null(), commercialPriceAssumptions: price,
    }).strict(),
  }).strict(),
  timing: z.object({ notBefore: instant, expiresAt: instant }).strict(),
  sendPlanId: uuid, broadcastId: uuid,
  recipientCount: z.number().int().positive().safe(),
  commercialGrantId: z.string().regex(/^commercial:grant:v1:sha256:[0-9a-f]{64}$/u),
  acceptedCandidateDigest: digest, acceptedReviewDigest: digest,
}).strict();
export const sendPreparedBroadcastInputSchema = z.object({
  workspace: z.string().min(1).max(300), draft_id: uuid,
  expected_revision: z.number().int().positive().safe(),
  snapshot_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  request_id: uuid, review: reviewSchema,
}).strict();
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
const selector = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => value === value.trim() && !/\p{Cc}/u.test(value));
const absolutePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine(path.isAbsolute)
  .refine((value) => !/\p{Cc}/u.test(value));

export const prepareBroadcastPavedInputSchema = z
  .object({
    workspace_selector: selector.optional(),
    environment: z.enum(["sandbox", "production"]).optional(),
    draft_id: uuid.optional(),
    create_new: z.boolean().optional(),
    title: nullableHeader(100, false).optional(),
    subject: nullableHeader(998, true).optional(),
    preheader: nullableHeader(500, true).optional(),
    text_source: nullableBody.optional(),
    html_source_file: absolutePath.optional(),
    html_reference_file: absolutePath.nullable().optional(),
    audience_file: absolutePath.optional(),
    postal_address_literal: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => !/\p{Cc}/u.test(value))
      .nullable()
      .optional(),
    literal_fallbacks: z
      .record(
        z.string().min(1).max(500),
        z.string().max(2_000).refine((value) => !/\p{Cc}/u.test(value)),
      )
      .refine((value) => Object.keys(value).length <= 25)
      .optional(),
    sender_selector: selector.optional(),
    audience_selector: selector.optional(),
    communication_purpose_selector: selector.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.draft_id && value.create_new === true) {
      context.addIssue({
        code: "custom",
        path: ["draft_id"],
        message: "Use an existing draft or create-new intent, not both.",
      });
    }
    if (value.html_source_file && value.text_source !== undefined && value.text_source !== null) {
      context.addIssue({
        code: "custom",
        path: ["text_source"],
        message: "Choose one content source.",
      });
    }
    if (value.html_reference_file && !value.html_source_file) {
      context.addIssue({
        code: "custom",
        path: ["html_reference_file"],
        message: "An HTML reference requires an HTML source file.",
      });
    }
    if (value.audience_file && value.audience_selector) {
      context.addIssue({
        code: "custom",
        path: ["audience_file"],
        message: "Choose a CSV audience file or an audience selector, not both.",
      });
    }
  });

const choiceSchema = z
  .object({
    field: z.string().min(1).max(100),
    value: z.string().min(1).max(500),
    label: z.string().min(1).max(500),
  })
  .strict();

export const broadcastPavedPreparationOutputSchema = z
  .object({
    status: z.enum(["ready_to_send", "preparing", "needs_input", "blocked"]),
    draft_id: uuid.nullable(),
    revision: z.number().int().positive().safe().nullable(),
    summary: z.string().min(1).max(2_000),
    missing: z.array(z.string().min(1).max(100)).max(30),
    choices: z.array(choiceSchema).max(500),
    warnings: z.array(z.string().min(1).max(300)).max(100),
    send_input: sendPreparedBroadcastInputSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "ready_to_send" &&
      (value.draft_id === null || value.revision === null || value.send_input === null || value.missing.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["send_input"],
        message: "Ready results require durable facts for the exact current draft revision.",
      });
    }
    if (
      value.status === "ready_to_send" &&
      value.send_input !== null &&
      (value.send_input.draft_id !== value.draft_id ||
        value.send_input.expected_revision !== value.revision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["send_input"],
        message: "Durable Send facts must match the prepared draft and revision.",
      });
    }
    if (
      value.status === "preparing" &&
      (value.missing.length > 0 || value.choices.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Preparing is automatic and cannot request human input.",
      });
    }
    if (value.status !== "ready_to_send" && value.send_input !== null) {
      context.addIssue({
        code: "custom",
        path: ["send_input"],
        message: "Only ready results may include Send input.",
      });
    }
  });

const canonicalStatusSchema = z.object({
  schema: z.literal("broadcast_send_operation"), operationId: uuid,
  workspaceId: z.string().min(1), environment: z.literal("production"), draftId: uuid,
  draftVersion: z.number().int().positive().safe(), broadcastId: uuid,
  sendPlanId: uuid, recipientCount: z.number().int().positive().safe(),
  phase: z.enum(["scheduled", "sending", "paused", "complete", "ended"]),
  accepted: z.number().int().nonnegative().safe(), skipped: z.number().int().nonnegative().safe(),
  failed: z.number().int().nonnegative().safe(), unknown: z.number().int().nonnegative().safe(),
  pending: z.number().int().nonnegative().safe(), executionAuthorized: z.literal(true),
  replayed: z.boolean(),
}).passthrough();
const sendOperationResultSchema = z.object({ kind: z.literal("executable_broadcast_operation"),
  status: z.literal("accepted"), operation: canonicalStatusSchema }).strict().nullable();

export const broadcastPavedSendOutputSchema = z
  .object({
    schema_version: z.literal("fonte.cli.operator_receipt.v1"),
    command: z.literal("broadcast_send_now"),
    outcome: z.enum([
      "queued",
      "terminal",
      "completed",
      "blocked",
      "unsupported_authority",
    ]),
    reason: z.string().min(1).max(100),
    workspace: z.string().min(1).max(300).nullable(),
    authority: z
      .object({
        status: z.enum(["current", "missing"]),
        contract_id: z.enum([
          "fonte.core.broadcast_send",
          "unavailable",
        ]),
      })
      .strict(),
    core_effect: z.enum([
      "none",
      "created",
      "replaced",
      "attempted",
      "queued",
      "controlled",
      "copied",
      "unknown",
    ]),
    result: sendOperationResultSchema,
  })
  .strict();
