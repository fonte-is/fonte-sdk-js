import { z } from "zod";

import type {
  SequenceJsonObject,
  SequenceJsonValue,
} from "./operator-sequence-types.js";

const outcomeSchema = z.enum([
  "completed",
  "unavailable",
  "denied",
  "conflict",
  "ambiguous",
]);
const coreEffectSchema = z.enum(["none", "unknown"]);
const reasonSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_]+$/)
  .nullable();
const statusCodeSchema = z.number().int().min(100).max(599).nullable();

const workspaceSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/);
const environmentSchema = z.enum(["sandbox", "production"]);
const identifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sequenceIdSchema = identifierSchema.refine(
  (value) => value !== "validate",
);
const mutationKeySchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value),
  );
const revisionSchema = z.number().int().positive().safe();
const timestampSchema = z.number().int().nonnegative().safe();

const jsonValueSchema: z.ZodType<SequenceJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const sequenceDefinitionSchema: z.ZodType<SequenceJsonObject> = z.record(
  z.string(),
  jsonValueSchema,
);

const scopeInput = {
  workspace: workspaceSchema,
  environment: environmentSchema,
} as const;

export const listSequencesInputSchema = z.object(scopeInput).strict();
export const readSequenceInputSchema = z
  .object({ ...scopeInput, sequence_id: sequenceIdSchema })
  .strict();
export const createSequenceInputSchema = z
  .object({
    ...scopeInput,
    sequence_id: sequenceIdSchema,
    operation_key: mutationKeySchema,
    definition: sequenceDefinitionSchema,
  })
  .strict();
export const updateSequenceInputSchema = z
  .object({
    ...scopeInput,
    sequence_id: sequenceIdSchema,
    expected_revision: revisionSchema,
    operation_key: mutationKeySchema,
    definition: sequenceDefinitionSchema,
  })
  .strict();
export const validateSequenceInputSchema = z
  .object({ ...scopeInput, definition: sequenceDefinitionSchema })
  .strict();
export const diffSequenceInputSchema = z
  .object({
    ...scopeInput,
    sequence_id: sequenceIdSchema,
    base_revision: revisionSchema.nullable().optional().default(null),
    definition: sequenceDefinitionSchema,
  })
  .strict();
export const exportSequenceInputSchema = readSequenceInputSchema;
export const simulateSequenceInputSchema = z
  .object({
    ...scopeInput,
    sequence_id: sequenceIdSchema,
    entered_at_ms: timestampSchema,
    assumed_accepted_at_ms: z
      .record(identifierSchema, timestampSchema)
      .optional()
      .default({}),
  })
  .strict();

const planStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      step_id: z.string().min(1),
      kind: z.literal("send"),
      content: z.enum(["complete", "incomplete"]),
      subject: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      step_id: z.string().min(1),
      kind: z.literal("wait_duration"),
      duration_seconds: z.number().int().positive().safe(),
    })
    .strict(),
]);
const planSchema = z
  .object({
    title: z.string().min(1),
    entry: z.literal("subscription_episode"),
    reentry: z.enum(["once", "each_qualifying_episode"]),
    steps: z.array(planStepSchema),
  })
  .strict();
const draftSchema = z
  .object({
    kind: z.literal("sequence_draft"),
    outcome: z.enum(["applied", "no_change", "replayed"]).nullable(),
    sequence_id: identifierSchema,
    revision: revisionSchema,
    definition: sequenceDefinitionSchema,
    plan: planSchema,
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();
const completed = {
  outcome: outcomeSchema,
  reason: reasonSchema,
  status_code: statusCodeSchema,
  core_effect: coreEffectSchema,
} as const;

export const listSequencesOutputSchema = z
  .object({ ...completed, sequences: z.array(draftSchema).nullable() })
  .strict();
export const sequenceOutputSchema = z
  .object({ ...completed, sequence: draftSchema.nullable() })
  .strict();
export const validationOutputSchema = z
  .object({
    ...completed,
    validation: z
      .object({
        kind: z.literal("sequence_validation"),
        valid: z.literal(true),
        definition: sequenceDefinitionSchema,
        plan: planSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export const diffOutputSchema = z
  .object({
    ...completed,
    diff: z
      .object({
        kind: z.literal("sequence_diff"),
        sequence_id: identifierSchema,
        base_revision: revisionSchema,
        current_revision: revisionSchema,
        diff: sequenceDefinitionSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export const exportOutputSchema = z
  .object({
    ...completed,
    export: z
      .object({
        kind: z.literal("sequence_export"),
        sequence_id: identifierSchema,
        revision: revisionSchema,
        definition: sequenceDefinitionSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export const simulationOutputSchema = z
  .object({
    ...completed,
    simulation: z
      .object({
        kind: z.literal("sequence_simulation"),
        sequence_id: identifierSchema,
        revision: revisionSchema,
        simulation: sequenceDefinitionSchema,
        delivery: z.literal("not_requested_by_authoring_preview"),
      })
      .strict()
      .nullable(),
  })
  .strict();
