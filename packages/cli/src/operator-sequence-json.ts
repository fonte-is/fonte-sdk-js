import { CoreOperatorError } from "./operator-core-request.js";
import type {
  SequenceActivationBindingResult,
  SequenceActivationOutcome,
  SequenceActivationResult,
  SequenceActivationScopeResult,
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

/**
 * Activation is an immutable Core version receipt. The client validates its
 * bounded transport shape but leaves definition and binding semantics to Core.
 */
export function sequenceActivation(
  value: unknown,
  environment: SequenceEnvironment,
): SequenceActivationResult {
  const envelope = bound(value, environment);
  const sequence = sequenceId(envelope.sequenceId);
  const draftRevision = revision(envelope.draftRevision);
  const version = activatedVersionResult(envelope.activatedVersion);
  if (version.draft_revision !== draftRevision) invalid();
  return {
    kind: "sequence_activation",
    outcome: activationOutcome(envelope.outcome),
    sequence_id: sequence,
    draft_revision: draftRevision,
    activated_version: version,
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

function activationOutcome(value: unknown): SequenceActivationOutcome {
  if (value === "activated" || value === "replayed") return value;
  invalid();
}

function activatedVersionResult(
  value: unknown,
): SequenceActivationResult["activated_version"] {
  const version = object(value);
  exactKeys(version, [
    "activatedAt",
    "activatedAtMs",
    "activatedVersionId",
    "binding",
    "current",
    "definition",
    "draftRevision",
    "version",
  ]);
  const activatedAt = instant(version.activatedAt);
  const activatedAtMs = nonNegativeInteger(version.activatedAtMs);
  if (Date.parse(activatedAt) !== activatedAtMs) invalid();
  if (typeof version.current !== "boolean") invalid();
  return {
    activated_version_id: boundedText(version.activatedVersionId, 200),
    version: revision(version.version),
    draft_revision: revision(version.draftRevision),
    definition: jsonObject(version.definition),
    binding: activationBinding(version.binding),
    activated_at: activatedAt,
    activated_at_ms: activatedAtMs,
    current: version.current,
  };
}

function activationBinding(value: unknown): SequenceActivationBindingResult {
  const binding = object(value);
  exactKeys(binding, ["messageRenderReferences", "scope", "senderId"]);
  return {
    sender_id: boundedText(binding.senderId, 200),
    scope: activationScope(binding.scope),
    message_render_references: array(binding.messageRenderReferences).map(
      messageRenderReference,
    ),
  };
}

function activationScope(value: unknown): SequenceActivationScopeResult {
  const scope = object(value);
  if (scope.kind === "general_marketing") {
    exactKeys(scope, ["kind"]);
    return { kind: "general_marketing" };
  }
  if (scope.kind === "campaign") {
    exactKeys(scope, ["campaignId", "kind"]);
    return {
      kind: "campaign",
      campaign_id: boundedText(scope.campaignId, 200),
    };
  }
  invalid();
}

function messageRenderReference(
  value: unknown,
): SequenceActivationBindingResult["message_render_references"][number] {
  const reference = object(value);
  exactKeys(reference, ["renderReference", "stepId"]);
  return {
    step_id: boundedText(reference.stepId, 200),
    render_reference: boundedText(reference.renderReference, 500),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    invalid();
  }
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

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
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
