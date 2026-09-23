import { z } from "zod";

import { broadcastDraftRevisionResultSchema } from "./mcp-broadcast-draft-revision-types.js";
import {
  mcpOperationIdSchema,
  mcpOutcomeSchema,
  mcpRevisionSchema,
  mcpWorkspaceSchema,
} from "./mcp-broadcast-render-types.js";

const boundedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim() && !/\p{Cc}/u.test(value));
const senderProfileIdSchema = boundedText(200);
const canonicalEmailSchema = boundedText(320).refine((value) => {
  const parts = value.split("@");
  return (
    value === value.toLowerCase() &&
    parts.length === 2 &&
    Boolean(parts[0]) &&
    Boolean(parts[1]?.includes(".")) &&
    !/\s/u.test(value)
  );
});
const replyToInputSchema = boundedText(320)
  .transform((value) => value.toLowerCase())
  .pipe(canonicalEmailSchema);

export const listBroadcastSendersInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    match: boundedText(320).nullable().optional(),
  })
  .strict();

const senderProfileSchema = z
  .object({
    sender_profile_id: senderProfileIdSchema,
    name: boundedText(120),
    email: canonicalEmailSchema,
    default_reply_to: canonicalEmailSchema,
  })
  .strict();
const senderResolutionSchema = z
  .object({
    outcome: z.enum(["selected", "ambiguous", "not_found"]),
    sender_profile_id: senderProfileIdSchema.nullable(),
    candidate_sender_profile_ids: z.array(senderProfileIdSchema),
  })
  .strict();
const senderCatalogSchema = z
  .object({
    kind: z.literal("broadcast_sender_catalog"),
    sender_profiles: z.array(senderProfileSchema),
    resolution: senderResolutionSchema,
  })
  .strict();

export const listBroadcastSendersOutputSchema = z
  .object({
    outcome: mcpOutcomeSchema,
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    catalog: senderCatalogSchema.nullable(),
  })
  .strict();

export const updateBroadcastSenderInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    base_revision: mcpRevisionSchema,
    operation_id: mcpOperationIdSchema,
    sender_profile_id: senderProfileIdSchema,
    reply_to: replyToInputSchema.optional(),
  })
  .strict();

export const updateBroadcastSenderOutputSchema = z
  .object({
    outcome: mcpOutcomeSchema,
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    revision: broadcastDraftRevisionResultSchema.nullable(),
  })
  .strict();
