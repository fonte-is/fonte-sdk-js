import type { CoreOperatorClient } from "./operator-client.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorResult,
} from "./operator-types.js";
import type { SequenceOperatorCommand } from "./operator-sequence-types.js";

export interface SequenceReceiptDescriptor {
  readonly outcome: "completed";
  readonly reason: string;
  readonly coreEffect: Exclude<OperatorReceipt["core_effect"], "unknown">;
}

export function isSequenceCommand(
  command: OperatorCommand,
): command is SequenceOperatorCommand {
  return command.kind.startsWith("sequence_");
}

export function executeSequenceCommand(
  command: SequenceOperatorCommand,
  client: CoreOperatorClient,
): Promise<OperatorResult> {
  if (command.kind === "sequence_list") return client.listSequences(command);
  if (command.kind === "sequence_read") return client.readSequence(command);
  if (command.kind === "sequence_create") return client.createSequence(command);
  if (command.kind === "sequence_update") return client.updateSequence(command);
  if (command.kind === "sequence_validate")
    return client.validateSequence(command);
  if (command.kind === "sequence_diff") return client.diffSequence(command);
  if (command.kind === "sequence_export") return client.exportSequence(command);
  return client.simulateSequence(command);
}

export function sequenceReceiptDescriptor(
  command: OperatorCommand,
  result: OperatorResult,
): SequenceReceiptDescriptor | null {
  if (!isSequenceCommand(command)) return null;
  if (result.kind === "sequence_list") {
    return completed("sequence_list_observed", "none");
  }
  if (result.kind === "sequence_validation") {
    return completed("sequence_definition_valid", "none");
  }
  if (result.kind === "sequence_diff") {
    return completed("sequence_definition_diff_observed", "none");
  }
  if (result.kind === "sequence_export") {
    return completed("sequence_definition_exported", "none");
  }
  if (result.kind === "sequence_simulation") {
    return completed("sequence_authoring_preview_observed", "none");
  }
  if (result.kind !== "sequence_draft") return null;
  if (command.kind === "sequence_create") {
    return mutationDescriptor("sequence_created", "created", result.outcome);
  }
  if (command.kind === "sequence_update") {
    return mutationDescriptor("sequence_updated", "replaced", result.outcome);
  }
  if (command.kind === "sequence_read") {
    return completed("sequence_observed", "none");
  }
  return null;
}

function mutationDescriptor(
  applied: string,
  effect: "created" | "replaced",
  outcome: "applied" | "no_change" | "replayed" | null,
): SequenceReceiptDescriptor | null {
  if (outcome === "applied") return completed(applied, effect);
  if (outcome === "no_change") return completed(`${applied}_no_change`, "none");
  if (outcome === "replayed") return completed(`${applied}_replayed`, "none");
  return null;
}

function completed(
  reason: string,
  coreEffect: SequenceReceiptDescriptor["coreEffect"],
): SequenceReceiptDescriptor {
  return { outcome: "completed", reason, coreEffect };
}
