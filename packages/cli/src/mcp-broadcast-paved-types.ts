import path from "node:path";
import { z } from "zod";

import { broadcastSendInstructionOutputSchema } from "./mcp-broadcast-send-instruction-types.js";

const uuid = z.string().uuid();
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
    status: z.enum(["ready_to_send", "needs_input", "blocked"]),
    draft_id: uuid.nullable(),
    revision: z.number().int().positive().safe().nullable(),
    summary: z.string().min(1).max(2_000),
    missing: z.array(z.string().min(1).max(100)).max(30),
    choices: z.array(choiceSchema).max(500),
    warnings: z.array(z.string().min(1).max(300)).max(100),
    send_input: z
      .object({ preparation_reference: z.string().min(1).max(100) })
      .strict()
      .nullable(),
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
        message: "Ready results require an exact preparation reference and current draft revision.",
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

export const sendPreparedBroadcastInputSchema = z
  .object({
    preparation_reference: z.string().regex(/^bpr1_[0-9a-f-]{36}$/iu),
  })
  .strict();

const sendOperationResultSchema = broadcastSendInstructionOutputSchema.shape.operation;

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
          "fonte.core.broadcast_send_instruction.v3",
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
