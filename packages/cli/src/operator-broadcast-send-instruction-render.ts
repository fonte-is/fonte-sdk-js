import type { OperatorReceipt } from "./operator-types.js";

export function renderBroadcastSendInstructionHuman(
  receipt: OperatorReceipt,
): string | null {
  const result = receipt.result;
  if (result?.kind !== "broadcast_send_operation") return null;
  if (result.status === "absent") {
    return "Fonte Broadcast Send: no durable operation exists for this draft.\nCore effect: none.\n";
  }
  const operation = result.operation;
  const action = operation.required_action;
  return [
    `Fonte Broadcast Send: ${displayPhase(operation.phase)}.`,
    `Operation/draft: ${operation.operation_id}/${operation.draft_id}.`,
    `Instruction/approval generation: ${operation.instruction_generation}/${operation.approval_generation}.`,
    `Recipients: ${operation.total ?? "unavailable"}.`,
    ...(action
      ? [
          `Action required: increase account spending limit to at least ${action.minimum_maximum_minor} ${action.currency} minor units.`,
          "Use `fonte broadcast send increase-limit` only after the customer explicitly authorizes that recurring account limit.",
        ]
      : []),
    operation.delivery.status === "unavailable"
      ? `Delivery: unavailable (${operation.delivery.reason}).`
      : `Provider accepted/not accepted/unresolved: ${operation.delivery.counts.provider_accepted ?? "unavailable"}/${operation.delivery.counts.definitively_not_accepted ?? "unavailable"}/${operation.delivery.counts.unresolved ?? "unavailable"}.`,
    `Core effect: ${receipt.core_effect}.`,
    "",
  ].join("\n");
}

function displayPhase(phase: string): string {
  if (
    ["preparing", "authorizing", "packaging", "activation_pending"].includes(
      phase,
    )
  ) {
    return "Preparing";
  }
  return phase
    .replaceAll("_", " ")
    .replace(/^./u, (value) => value.toUpperCase());
}
