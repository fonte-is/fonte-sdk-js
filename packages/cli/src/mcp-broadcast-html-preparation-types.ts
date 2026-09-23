import path from "node:path";
import { z } from "zod";

import { broadcastDraftLifecycleResultSchema } from "./mcp-broadcast-draft-lifecycle-types.js";
import {
  broadcastDraftRevisionResultSchema,
  broadcastDraftSnapshotSchema,
} from "./mcp-broadcast-draft-revision-types.js";
import {
  broadcastDraftRenderResultSchema,
  mcpOperationIdSchema,
  mcpRevisionSchema,
  mcpWorkspaceSchema,
} from "./mcp-broadcast-render-types.js";

const absolutePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine(path.isAbsolute)
  .refine((value) => !/\p{Cc}/u.test(value));
const nullableHeader = (maximum: number) =>
  z.union([
    z.null(),
    z
      .string()
      .max(maximum)
      .refine((value) => !/\p{Cc}/u.test(value)),
  ]);
const literalFallbacks = z
  .record(
    z.string().min(1).max(500),
    z
      .string()
      .max(2_000)
      .refine((value) => !/\p{Cc}/u.test(value)),
  )
  .refine((value) => Object.keys(value).length <= 25);
const sourceFields = {
  source_file: absolutePath,
  reference_file: absolutePath.nullable(),
  postal_address_literal: z.union([
    z.null(),
    z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => !/\p{Cc}/u.test(value)),
  ]),
  literal_fallbacks: literalFallbacks,
};

export const prepareBroadcastHtmlInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    title: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => !/\p{Cc}/u.test(value)),
    subject: nullableHeader(998),
    preheader: nullableHeader(500),
    ...sourceFields,
  })
  .strict();

export const reviseBroadcastHtmlInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    base_revision: mcpRevisionSchema,
    operation_id: mcpOperationIdSchema,
    ...sourceFields,
  })
  .strict();

const conversionSchema = z
  .object({
    kind: z.enum(["provider_token", "provider_artifact", "literal_fallback"]),
    source: z.string(),
    replacement: z.string(),
    occurrences: z.number().int().positive().safe(),
  })
  .strict();

export const broadcastHtmlSourceReportSchema = z
  .object({
    schema_version: z.literal("fonte-broadcast-html-intake-v1"),
    source_file: absolutePath,
    source_bytes: z.number().int().nonnegative().safe(),
    source_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    prepared_bytes: z.number().int().nonnegative().safe(),
    prepared_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    recipient_slot_schema_version: z.literal("fonte-core-recipient-slots-v1"),
    supported_slots: z
      .array(
        z
          .object({
            token: z.string(),
            occurrences: z.number().int().nonnegative().safe(),
          })
          .strict(),
      )
      .length(3),
    unsupported_tokens: z.array(z.string()).max(100),
    conversions: z.array(conversionSchema).max(100),
    asset_dependencies: z.array(z.string()).max(100),
    font_status: z.enum(["declared", "unverified"]),
    reference: z
      .object({
        file: absolutePath,
        bytes: z.number().int().nonnegative().safe(),
        sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict()
      .nullable(),
    visual_verification: z.enum([
      "unverified_missing_reference",
      "reference_bound_not_compared",
    ]),
    warnings: z.array(z.string().min(1).max(100)).max(20),
    blockers: z.array(z.string().min(1).max(100)).max(20),
    plain_text_source: z.literal("core_canonical_render"),
  })
  .strict();

export const broadcastHtmlPreparationOutputSchema = z
  .object({
    outcome: z.enum([
      "completed",
      "blocked",
      "unavailable",
      "denied",
      "conflict",
      "ambiguous",
    ]),
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    stage: z.enum(["intake", "save", "readback", "render", "complete"]),
    action: z.enum(["create", "revise"]),
    source: broadcastHtmlSourceReportSchema.nullable(),
    save: z
      .union([
        broadcastDraftLifecycleResultSchema,
        broadcastDraftRevisionResultSchema,
      ])
      .nullable(),
    readback: z
      .object({
        kind: z.literal("broadcast_draft"),
        outcome: z.null(),
        draft_id: z.string().uuid(),
        revision: mcpRevisionSchema,
        draft: broadcastDraftSnapshotSchema,
      })
      .strict()
      .nullable(),
    render: broadcastDraftRenderResultSchema.nullable(),
  })
  .strict();
