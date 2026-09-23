import { z } from "zod";

export const mcpWorkspaceSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/);
export const mcpRevisionSchema = z.number().int().positive().safe();
export const mcpOperationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value),
  );
export const mcpOutcomeSchema = z.enum([
  "completed",
  "unavailable",
  "denied",
  "conflict",
  "ambiguous",
]);
export const mcpRenderProofSchema = z
  .object({
    source: z.enum(["composer", "html"]),
    template_identity: z.enum(["workspace_broadcast_v1", "complete_html_v1"]),
    template_revision: z.string().min(1).max(2_000),
    broadcast_version: mcpRevisionSchema,
    renderer_version: z.string().min(1).max(2_000),
    recipient_slot_schema_version: z.string().min(1).max(2_000),
    finalizer_version: z.string().min(1).max(2_000),
    text_source: z.literal("draft"),
    render_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();

export const renderBroadcastDraftInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    revision: mcpRevisionSchema,
  })
  .strict();

export const broadcastDraftRenderResultSchema = z
  .object({
    kind: z.literal("broadcast_draft_render"),
    draft_id: z.string().uuid(),
    revision: mcpRevisionSchema,
    sender_profile_id: z.string().min(1).max(2_000),
    render_content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    subject: z.string().min(1).max(2_000),
    reply_to: z.string().max(2_000).nullable(),
    preheader: z.string().max(2_000).nullable(),
    postal_address: z.string().max(2_000).nullable(),
    click_tracking_enabled: z.boolean(),
    html: z.string().min(1).max(524_288),
    text: z.string().min(1).max(524_288),
    render_proof: mcpRenderProofSchema,
    sample_render: z
      .object({
        recipient_email: z.string().min(1).max(2_000),
        unsubscribe_url: z.string().url().max(2_000),
        postal_address: z.string().max(2_000).nullable(),
        finalizer_version: z.string().min(1).max(2_000),
        html: z.string().min(1).max(524_288),
        text: z.string().min(1).max(524_288),
      })
      .strict(),
  })
  .strict();

export const renderBroadcastDraftOutputSchema = z
  .object({
    outcome: mcpOutcomeSchema,
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    render: broadcastDraftRenderResultSchema.nullable(),
  })
  .strict();
