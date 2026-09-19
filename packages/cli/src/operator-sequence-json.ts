import { CoreOperatorError } from "./operator-core-request.js";
import type {
  SequenceDiffResult,
  SequenceDraftResult,
  SequenceEnvironment,
  SequenceExportResult,
  SequenceJsonObject,
  SequenceListResult,
  SequenceMutationOutcome,
  SequencePlan,
  SequencePlanStep,
  SequenceSimulationResult,
  SequenceValidationResult,
} from "./operator-sequence-types.js";

export function sequenceList(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceListResult {
  const envelope = bound(value, environment);
  return {
    kind: "sequence_list",
    sequences: array(envelope.rows).map((item) => sequenceDraft(item, null)),
  };
}

export function sequenceDraftEnvelope(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceDraftResult {
  const envelope = bound(value, environment);
  const result = sequenceDraft(envelope.sequence, outcome(envelope.outcome));
  return result;
}

export function sequenceValidation(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceValidationResult {
  const envelope = bound(value, environment);
  if (envelope.valid !== true) invalid();
  return {
    kind: "sequence_validation",
    valid: true,
    definition: jsonObject(envelope.definition),
    plan: sequencePlan(envelope.plan),
  };
}

export function sequenceDiff(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceDiffResult {
  const envelope = bound(value, environment);
  return {
    kind: "sequence_diff",
    sequence_id: sequenceId(envelope.sequenceId),
    base_revision: revision(envelope.baseRevision),
    current_revision: revision(envelope.currentRevision),
    diff: jsonObject(envelope.diff),
  };
}

export function sequenceExport(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceExportResult {
  const envelope = bound(value, environment);
  return {
    kind: "sequence_export",
    sequence_id: sequenceId(envelope.sequenceId),
    revision: revision(envelope.revision),
    definition: jsonObject(envelope.definition),
  };
}

export function sequenceSimulation(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceSimulationResult {
  const envelope = bound(value, environment);
  if (envelope.delivery !== "not_requested_by_authoring_preview") invalid();
  return {
    kind: "sequence_simulation",
    sequence_id: sequenceId(envelope.sequenceId),
    revision: revision(envelope.revision),
    simulation: jsonObject(envelope.simulation),
    delivery: "not_requested_by_authoring_preview",
  };
}

function sequenceDraft(
  value: unknown,
  mutationOutcome: SequenceMutationOutcome | null,
): SequenceDraftResult {
  const body = object(value);
  return {
    kind: "sequence_draft",
    outcome: mutationOutcome,
    sequence_id: sequenceId(body.sequenceId),
    revision: revision(body.revision),
    definition: jsonObject(body.definition),
    plan: sequencePlan(body.plan),
    created_at: instant(body.createdAt),
    updated_at: instant(body.updatedAt),
  };
}

function sequencePlan(value: unknown): SequencePlan {
  const plan = object(value);
  const entry = plan.entry;
  const reentry = plan.reentry;
  if (entry !== "subscription_episode") invalid();
  if (reentry !== "once" && reentry !== "each_qualifying_episode") invalid();
  return {
    title: text(plan.title),
    entry,
    reentry,
    steps: array(plan.steps).map(sequencePlanStep),
  };
}

function sequencePlanStep(value: unknown): SequencePlanStep {
  const step = object(value);
  const stepId = text(step.stepId);
  if (step.kind === "send") {
    if (
      (step.content !== "complete" && step.content !== "incomplete") ||
      (step.subject !== null && typeof step.subject !== "string")
    ) {
      invalid();
    }
    return {
      step_id: stepId,
      kind: "send",
      content: step.content,
      subject: step.subject === null ? null : text(step.subject),
    };
  }
  if (step.kind === "wait_duration") {
    return {
      step_id: stepId,
      kind: "wait_duration",
      duration_seconds: positiveInteger(step.durationSeconds),
    };
  }
  invalid();
}

function bound(
  value: unknown,
  environment: SequenceEnvironment,
): Record<string, unknown> {
  const envelope = object(value);
  if (text(envelope.tenantId) === "" || envelope.environment !== environment) {
    invalid();
  }
  return envelope;
}

function outcome(value: unknown): SequenceMutationOutcome | null {
  if (value === undefined || value === null) return null;
  if (value === "applied" || value === "no_change" || value === "replayed")
    return value;
  invalid();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function jsonObject(value: unknown): SequenceJsonObject {
  return object(value) as SequenceJsonObject;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function sequenceId(value: unknown): string {
  const result = boundedText(value, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) invalid();
  return result;
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  const result = text(value);
  if (result.length > maximum) invalid();
  return result;
}

function revision(value: unknown): number {
  return positiveInteger(value);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalid();
  }
  return value;
}

function instant(value: unknown): string {
  const result = text(value);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result)
    invalid();
  return result;
}

function invalid(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
}
