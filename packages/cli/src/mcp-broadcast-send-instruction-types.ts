import { z } from "zod";

import {
  mcpOutcomeSchema,
  mcpRevisionSchema,
  mcpWorkspaceSchema,
} from "./mcp-broadcast-render-types.js";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const sendScope = {
  workspace: mcpWorkspaceSchema,
  draft_id: uuid,
} as const;
const mutationIdentity = { request_id: uuid } as const;

export const sendBroadcastNowInputSchema = z
  .object({
    ...sendScope,
    ...mutationIdentity,
    expected_draft_version: mcpRevisionSchema,
  })
  .strict();

export const scheduleBroadcastInputSchema = z
  .object({
    ...sendScope,
    ...mutationIdentity,
    expected_draft_version: mcpRevisionSchema,
    not_before: instant,
  })
  .strict();

export const readBroadcastSendOperationInputSchema = z
  .object(sendScope)
  .strict();

export const replaceBroadcastScheduleInputSchema = z
  .object({
    ...sendScope,
    ...mutationIdentity,
    expected_instruction_generation: mcpRevisionSchema,
    expected_draft_version: mcpRevisionSchema,
    not_before: instant,
  })
  .strict();

export const cancelBroadcastSendInputSchema = z
  .object({
    ...sendScope,
    ...mutationIdentity,
    expected_instruction_generation: mcpRevisionSchema,
  })
  .strict();

export const increaseBroadcastSpendLimitInputSchema = z
  .object({
    ...sendScope,
    ...mutationIdentity,
    expected_instruction_generation: mcpRevisionSchema,
    expected_approval_generation: mcpRevisionSchema,
  })
  .strict();

const timing = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }).strict(),
  z.object({ mode: z.literal("scheduled"), not_before: instant }).strict(),
]);
const requiredAction = z
  .object({
    kind: z.literal("increase_account_spend_limit"),
    billing_account_id: z.string().min(1).max(300),
    currency: z.literal("USD"),
    current_maximum_minor: z.number().int().nonnegative().safe().nullable(),
    minimum_maximum_minor: z.number().int().positive().safe(),
  })
  .strict();
const delivery = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.string().min(1).max(300),
      observed_at: instant.nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("available"),
      coverage: z.enum(["complete", "partial"]),
      observed_at: instant,
      counts: z
        .object({
          provider_accepted: z.number().int().nonnegative().safe().nullable(),
          definitively_not_accepted: z
            .number()
            .int()
            .nonnegative()
            .safe()
            .nullable(),
          unresolved: z.number().int().nonnegative().safe().nullable(),
        })
        .strict(),
    })
    .strict(),
]);
const operation = z
  .object({
    schema: z.literal("broadcast_send_operation.v2"),
    operation_id: uuid,
    workspace_id: z.string().min(1).max(300),
    environment: z.literal("production"),
    draft_id: uuid,
    instruction_generation: mcpRevisionSchema,
    approval_generation: mcpRevisionSchema,
    accepted_at: instant,
    timing,
    not_before: instant,
    phase: z.enum([
      "scheduled",
      "queued",
      "preparing",
      "authorizing",
      "packaging",
      "activation_pending",
      "sending",
      "waiting",
      "action_required",
      "stopping",
      "paused",
      "under_review",
      "canceling",
      "canceled",
      "complete",
      "failed",
    ]),
    reason: z.string().min(1).max(300).nullable(),
    retryable: z.boolean(),
    next_attempt_at: instant.nullable(),
    total: z.number().int().nonnegative().safe().nullable(),
    timestamps: z
      .object({
        preparation_started_at: instant.nullable(),
        snapshot_at: instant.nullable(),
        authorization_committed_at: instant.nullable(),
        first_submission_at: instant.nullable(),
        terminal_at: instant.nullable(),
      })
      .strict(),
    delivery,
    required_action: requiredAction.nullable(),
    allowed_actions: z
      .array(
        z.enum([
          "cancel",
          "replace_schedule",
          "amend_approval",
          "pause",
          "resume",
          "increase_spend_limit",
          "open_required_action",
        ]),
      )
      .max(16),
    execution_authorized: z.literal(false),
    replayed: z.boolean(),
  })
  .strict();

export const broadcastSendInstructionOutputSchema = z
  .object({
    outcome: mcpOutcomeSchema,
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    operation: z
      .object({
        kind: z.literal("broadcast_send_operation"),
        status: z.enum(["accepted", "absent"]),
        operation: operation.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
