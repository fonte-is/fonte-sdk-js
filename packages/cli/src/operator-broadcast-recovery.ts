export interface OperatorNextAction {
  readonly kind: "run_command";
  readonly command: string;
  readonly retry_mutation: false;
}

interface BroadcastRecoveryCommand {
  readonly kind: string;
  readonly workspace?: string;
  readonly broadcastId?: string;
}

interface ReceiptWithEffect {
  readonly core_effect: string;
  readonly next_action?: OperatorNextAction;
}

export function withAmbiguousBroadcastRecovery<
  Receipt extends ReceiptWithEffect,
>(command: BroadcastRecoveryCommand, receipt: Receipt): Receipt {
  if (
    receipt.core_effect !== "unknown" ||
    (command.kind !== "broadcast_canary" &&
      command.kind !== "broadcast_control") ||
    !command.workspace ||
    !command.broadcastId
  ) {
    return receipt;
  }
  return {
    ...receipt,
    next_action: {
      kind: "run_command",
      command: `fonte broadcast status --workspace ${command.workspace} --environment production --broadcast-id ${command.broadcastId} --json`,
      retry_mutation: false,
    },
  };
}

export function renderAmbiguousBroadcastRecovery(
  receipt: ReceiptWithEffect,
): readonly string[] {
  if (receipt.core_effect !== "unknown" || !receipt.next_action) return [];
  return [
    `Authoritative readback: ${receipt.next_action.command}.`,
    "Do not retry the mutation.",
  ];
}
