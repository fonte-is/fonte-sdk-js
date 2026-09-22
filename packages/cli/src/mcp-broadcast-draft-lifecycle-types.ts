import { z } from "zod";

import { broadcastDraftSnapshotSchema } from
  "./mcp-broadcast-draft-revision-types.js";
import {
  mcpOutcomeSchema,
  mcpWorkspaceSchema,
} from "./mcp-broadcast-render-types.js";

const nullableHeader = (maximum: number, allowEmpty: boolean) =>
  z.union([
    z.null(),
    z.string().max(maximum)
      .refine((value) => allowEmpty || value.length > 0)
      .refine((value) => !/\p{Cc}/u.test(value)),
  ]);
const nullableBody = z.union([
  z.null(),
  z.string()
    .refine((value) => new TextEncoder().encode(value).byteLength <= 262_144)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
    ),
]);

export const createBroadcastDraftInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    title: nullableHeader(100, false),
    subject: nullableHeader(998, true),
    preheader: nullableHeader(500, true),
    active_source: z.enum(["composer", "html"]),
    composer_body: nullableBody,
    html_body: nullableBody,
  })
  .strict();

export const readBroadcastDraftInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
  })
  .strict();

const lifecycleResultSchema = z
  .object({
    kind: z.literal("broadcast_draft"),
    outcome: z.enum(["applied", "no_change"]).nullable(),
    draft_id: z.string().uuid(),
    revision: z.number().int().positive().safe(),
    draft: broadcastDraftSnapshotSchema,
  })
  .strict();

export const broadcastDraftLifecycleOutputSchema = z
  .object({
    outcome: mcpOutcomeSchema,
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    draft: lifecycleResultSchema.nullable(),
  })
  .strict();
