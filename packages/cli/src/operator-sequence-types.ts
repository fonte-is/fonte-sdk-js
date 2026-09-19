/**
 * Sequence definitions remain Core-owned JSON. The CLI deliberately does not
 * duplicate the definition grammar or retain a local copy of a Sequence.
 */
export type SequenceJsonValue =
  | null
  | boolean
  | number
  | string
  | SequenceJsonObject
  | readonly SequenceJsonValue[];

export interface SequenceJsonObject {
  readonly [key: string]: SequenceJsonValue;
}

export type SequenceEnvironment = "sandbox" | "production";

export interface SequenceScopeInput {
  readonly workspace: string;
  readonly environment: SequenceEnvironment;
}

export interface SequenceReadInput extends SequenceScopeInput {
  readonly sequenceId: string;
}

export interface SequenceCreateInput extends SequenceScopeInput {
  /**
   * The caller-owned identity is required so an ambiguous create has a safe
   * authoritative readback. Core remains the sole idempotency authority.
   */
  readonly sequenceId: string;
  readonly operationKey: string;
  readonly definition: SequenceJsonObject;
}

export interface SequenceUpdateInput extends SequenceReadInput {
  readonly expectedRevision: number;
  readonly operationKey: string;
  readonly definition: SequenceJsonObject;
}

export interface SequenceValidationInput extends SequenceScopeInput {
  readonly definition: SequenceJsonObject;
}

export interface SequenceDiffInput extends SequenceReadInput {
  readonly baseRevision: number | null;
  readonly definition: SequenceJsonObject;
}

export interface SequenceSimulationInput extends SequenceReadInput {
  readonly enteredAtMs: number;
  readonly assumedAcceptedAtMs: Readonly<Record<string, number>>;
}

export interface SequencePlan {
  readonly title: string;
  readonly entry: "subscription_episode";
  readonly reentry: "once" | "each_qualifying_episode";
  readonly steps: readonly SequencePlanStep[];
}

export type SequencePlanStep =
  | {
      readonly step_id: string;
      readonly kind: "send";
      readonly content: "complete" | "incomplete";
      readonly subject: string | null;
    }
  | {
      readonly step_id: string;
      readonly kind: "wait_duration";
      readonly duration_seconds: number;
    };

export type SequenceMutationOutcome = "applied" | "no_change" | "replayed";

export interface SequenceDraftResult {
  readonly kind: "sequence_draft";
  readonly outcome: SequenceMutationOutcome | null;
  readonly sequence_id: string;
  readonly revision: number;
  readonly definition: SequenceJsonObject;
  readonly plan: SequencePlan;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SequenceListResult {
  readonly kind: "sequence_list";
  readonly sequences: readonly SequenceDraftResult[];
}

export interface SequenceValidationResult {
  readonly kind: "sequence_validation";
  readonly valid: true;
  readonly definition: SequenceJsonObject;
  readonly plan: SequencePlan;
}

export interface SequenceDiffResult {
  readonly kind: "sequence_diff";
  readonly sequence_id: string;
  readonly base_revision: number;
  readonly current_revision: number;
  readonly diff: SequenceJsonObject;
}

export interface SequenceExportResult {
  readonly kind: "sequence_export";
  readonly sequence_id: string;
  readonly revision: number;
  readonly definition: SequenceJsonObject;
}

export interface SequenceSimulationResult {
  readonly kind: "sequence_simulation";
  readonly sequence_id: string;
  readonly revision: number;
  readonly simulation: SequenceJsonObject;
  readonly delivery: "not_requested_by_authoring_preview";
}

export type SequenceOperatorCommand =
  | ({ readonly kind: "sequence_list" } & SequenceScopeInput)
  | ({ readonly kind: "sequence_read" } & SequenceReadInput)
  | ({ readonly kind: "sequence_create" } & SequenceCreateInput)
  | ({ readonly kind: "sequence_update" } & SequenceUpdateInput)
  | ({ readonly kind: "sequence_validate" } & SequenceValidationInput)
  | ({ readonly kind: "sequence_diff" } & SequenceDiffInput)
  | ({ readonly kind: "sequence_export" } & SequenceReadInput)
  | ({ readonly kind: "sequence_simulate" } & SequenceSimulationInput);

export type SequenceOperatorResult =
  | SequenceDraftResult
  | SequenceListResult
  | SequenceValidationResult
  | SequenceDiffResult
  | SequenceExportResult
  | SequenceSimulationResult;
