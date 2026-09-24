import type { CoreRequester } from "./operator-core-request.js";
import {
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";
import {
  sequenceActivation,
  sequenceDiff,
  sequenceDraftEnvelope,
  sequenceExport,
  sequenceList,
  sequenceSimulation,
  sequenceValidation,
} from "./operator-sequence-json.js";
import type {
  SequenceActivateInput,
  SequenceActivationResult,
  SequenceCreateInput,
  SequenceDiffInput,
  SequenceDiffResult,
  SequenceDraftResult,
  SequenceExportResult,
  SequenceListResult,
  SequenceReadInput,
  SequenceSimulationInput,
  SequenceSimulationResult,
  SequenceUpdateInput,
  SequenceValidationInput,
  SequenceValidationResult,
} from "./operator-sequence-types.js";

export interface SequenceAuthoringClient {
  listSequences(input: {
    readonly workspace: string;
    readonly environment: "sandbox" | "production";
  }): Promise<SequenceListResult>;
  readSequence(input: SequenceReadInput): Promise<SequenceDraftResult>;
  createSequence(input: SequenceCreateInput): Promise<SequenceDraftResult>;
  updateSequence(input: SequenceUpdateInput): Promise<SequenceDraftResult>;
  validateSequence(
    input: SequenceValidationInput,
  ): Promise<SequenceValidationResult>;
  diffSequence(input: SequenceDiffInput): Promise<SequenceDiffResult>;
  exportSequence(input: SequenceReadInput): Promise<SequenceExportResult>;
  simulateSequence(
    input: SequenceSimulationInput,
  ): Promise<SequenceSimulationResult>;
  activateSequence(input: SequenceActivateInput): Promise<SequenceActivationResult>;
}

export function createSequenceAuthoringClient(
  request: CoreRequester,
): SequenceAuthoringClient {
  return {
    async listSequences(input) {
      return sequenceList(
        await request(collectionPath(input.workspace, input.environment)),
        input.environment,
      );
    },
    async readSequence(input) {
      const result = sequenceDraftEnvelope(
        await request(itemPath(input)),
        input.environment,
      );
      return matchingDraft(result, input.sequenceId, "none");
    },
    async createSequence(input) {
      const result = mutationEnvelope(
        await request(collectionPath(input.workspace, input.environment), {
          idempotencyKey: input.operationKey,
          body: {
            operationKey: input.operationKey,
            sequenceId: input.sequenceId,
            definition: input.definition,
          },
          lostResponseEffect: "unknown",
        }),
        input.environment,
      );
      if (result.outcome === null) invalid("unknown");
      return matchingDraft(result, input.sequenceId, "unknown");
    },
    async updateSequence(input) {
      const result = mutationEnvelope(
        await request(itemPath(input), {
          method: "PUT",
          idempotencyKey: input.operationKey,
          body: {
            operationKey: input.operationKey,
            expectedRevision: input.expectedRevision,
            definition: input.definition,
          },
          lostResponseEffect: "unknown",
        }),
        input.environment,
      );
      if (result.outcome === null) invalid("unknown");
      return matchingDraft(result, input.sequenceId, "unknown");
    },
    async validateSequence(input) {
      return sequenceValidation(
        await request(validationPath(input.workspace, input.environment), {
          body: { definition: input.definition },
          lostResponseEffect: "none",
        }),
        input.environment,
      );
    },
    async diffSequence(input) {
      const body = {
        definition: input.definition,
        ...(input.baseRevision === null
          ? {}
          : { baseRevision: input.baseRevision }),
      };
      const result = sequenceDiff(
        await request(itemSubresourcePath(input, "diff"), {
          body,
          lostResponseEffect: "none",
        }),
        input.environment,
      );
      return matching(result, input.sequenceId);
    },
    async exportSequence(input) {
      const result = sequenceExport(
        await request(itemSubresourcePath(input, "export")),
        input.environment,
      );
      return matching(result, input.sequenceId);
    },
    async simulateSequence(input) {
      const result = sequenceSimulation(
        await request(itemSubresourcePath(input, "simulate"), {
          body: {
            enteredAtMs: input.enteredAtMs,
            assumedAcceptedAtMs: input.assumedAcceptedAtMs,
          },
          lostResponseEffect: "none",
        }),
        input.environment,
      );
      return matching(result, input.sequenceId);
    },
    async activateSequence(input) {
      const result = activationEnvelope(
        await request(itemSubresourcePath(input, "activate"), {
          idempotencyKey: input.operationKey,
          body: {
            operationKey: input.operationKey,
            expectedRevision: input.expectedRevision,
            binding: input.binding,
          },
          lostResponseEffect: "unknown",
        }),
        input.environment,
      );
      return matching(result, input.sequenceId, "unknown");
    },
  };
}

function collectionPath(
  workspace: string,
  environment: "sandbox" | "production",
): string {
  return `/v1/workspaces/${segment(workspace)}/sequences?environment=${environment}`;
}

function itemPath(input: SequenceReadInput): string {
  return `/v1/workspaces/${segment(input.workspace)}/sequences/${segment(input.sequenceId)}?environment=${input.environment}`;
}

function validationPath(
  workspace: string,
  environment: "sandbox" | "production",
): string {
  return `/v1/workspaces/${segment(workspace)}/sequences/validate?environment=${environment}`;
}

function itemSubresourcePath(
  input: SequenceReadInput,
  subresource: "activate" | "diff" | "export" | "simulate",
): string {
  return `/v1/workspaces/${segment(input.workspace)}/sequences/${segment(input.sequenceId)}/${subresource}?environment=${input.environment}`;
}

function matchingDraft(
  result: SequenceDraftResult,
  sequenceId: string,
  effect: "none" | "unknown",
): SequenceDraftResult {
  return matching(result, sequenceId, effect);
}

/** A malformed successful mutation receipt still leaves Core effect uncertain. */
function mutationEnvelope(
  value: unknown,
  environment: "sandbox" | "production",
): SequenceDraftResult {
  return parseCoreReceipt(
    (receipt) => sequenceDraftEnvelope(receipt, environment),
    value,
    "unknown",
  );
}

/** A malformed successful activation receipt leaves its Core effect unknown. */
function activationEnvelope(
  value: unknown,
  environment: "sandbox" | "production",
): SequenceActivationResult {
  return parseCoreReceipt(
    (receipt) => sequenceActivation(receipt, environment),
    value,
    "unknown",
  );
}

function matching<T extends { readonly sequence_id: string }>(
  result: T,
  sequenceId: string,
  effect: "none" | "unknown" = "none",
): T {
  if (result.sequence_id !== sequenceId) invalid(effect);
  return result;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalid(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
