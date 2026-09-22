import type { OperatorNextAction } from "./operator-broadcast-recovery.js";

interface SequenceRecoveryCommand {
  readonly kind: string;
  readonly workspace?: string;
  readonly environment?: "sandbox" | "production";
  readonly sequenceId?: string;
}

interface ReceiptWithEffect {
  readonly core_effect: string;
  readonly next_action?: OperatorNextAction;
}

/**
 * Core owns mutation replay. When a create or update response is lost, the
 * client must read the known caller-owned Sequence ID before doing anything
 * else; it must not resubmit the mutation blindly. Activation intentionally
 * receives no draft-read instruction: the draft route cannot prove whether an
 * activated version was recorded, and this SDK does not invent that readback.
 */
export function withAmbiguousSequenceRecovery<
  Receipt extends ReceiptWithEffect,
>(command: SequenceRecoveryCommand, receipt: Receipt): Receipt {
  if (
    receipt.core_effect !== "unknown" ||
    (command.kind !== "sequence_create" &&
      command.kind !== "sequence_update") ||
    !command.workspace ||
    !command.environment ||
    !command.sequenceId
  ) {
    return receipt;
  }
  return {
    ...receipt,
    next_action: {
      kind: "run_command",
      command:
        `fonte sequence read --workspace ${argument(command.workspace)}` +
        ` --environment ${command.environment}` +
        ` --sequence-id ${argument(command.sequenceId)} --json`,
      retry_mutation: false,
    },
  };
}

function argument(value: string): string {
  if (/^[A-Za-z0-9._:@/-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
