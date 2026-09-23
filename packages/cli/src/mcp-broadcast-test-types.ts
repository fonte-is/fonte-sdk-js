import { z } from "zod";
import {
  mcpOperationIdSchema,
  mcpOutcomeSchema,
  mcpRenderProofSchema,
  mcpRevisionSchema,
  mcpWorkspaceSchema,
} from "./mcp-broadcast-render-types.js";

export const requestBroadcastTestInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    revision: mcpRevisionSchema,
    operation_id: mcpOperationIdSchema,
    render_proof: mcpRenderProofSchema,
  })
  .strict();

const testRequestSchema = z
  .object({
    kind: z.literal("broadcast_test_request"),
    draft_id: z.string().uuid(),
    test_id: z.string().uuid(),
    revision: mcpRevisionSchema,
    operation_id: mcpOperationIdSchema,
    replayed: z.boolean(),
    render_proof: mcpRenderProofSchema,
  })
  .strict();

export const requestBroadcastTestOutputSchema = outputSchema(
  "test_request",
  testRequestSchema,
);

export const readBroadcastTestInputSchema = z
  .object({
    workspace: mcpWorkspaceSchema,
    draft_id: z.string().uuid(),
    test_id: z.string().uuid(),
  })
  .strict();

const testResultSchema = z
  .object({
    kind: z.literal("broadcast_test_result"),
    draft_id: z.string().uuid(),
    test_id: z.string().uuid(),
    revision: mcpRevisionSchema,
    status: z.enum(["processing", "unknown", "terminal"]),
    poll_after_milliseconds: z.number().int().nonnegative().nullable(),
    feedback_observations_may_change: z.boolean(),
    accepted_count: z.number().int().nonnegative(),
    refused_count: z.number().int().nonnegative(),
    unknown_count: z.number().int().nonnegative(),
    provider_submission_status: z.enum([
      "processing",
      "accepted",
      "partially_accepted",
      "refused",
      "unknown",
      "not_submitted",
    ]),
    provider_outcome: z.enum(["accepted", "refused", "unknown"]),
    delivery_outcome: z.enum(["delivered", "not_delivered", "unknown"]),
    inbox_confirmation: z.literal("unavailable"),
    provider_message_id: z.string().max(2_000).nullable(),
    feedback: z
      .object({
        recipient_result_count: z.number().int().nonnegative(),
        provider_accepted_count: z.number().int().nonnegative(),
        delivered_count: z.number().int().nonnegative(),
        delivery_delayed_count: z.number().int().nonnegative(),
        bounced_count: z.number().int().nonnegative(),
        complained_count: z.number().int().nonnegative(),
        rejected_count: z.number().int().nonnegative(),
        rendering_failed_count: z.number().int().nonnegative(),
      })
      .strict(),
    version_unchanged_since_test: z.boolean(),
    render_proof: mcpRenderProofSchema,
  })
  .strict();

export const readBroadcastTestOutputSchema = outputSchema(
  "test_result",
  testResultSchema,
);

function outputSchema<Key extends string, Value extends z.ZodType>(
  key: Key,
  value: Value,
) {
  return z
    .object({
      outcome: mcpOutcomeSchema,
      reason: z.string().min(1).max(100).nullable(),
      status_code: z.number().int().min(100).max(599).nullable(),
      core_effect: z.enum(["none", "unknown"]),
      [key]: value.nullable(),
    })
    .strict();
}
