export type OperatorNextAction =
  | {
      readonly kind: "read_campaign_command";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly operation_id: string;
      readonly resource_id: string;
    }
  | {
      readonly kind: "read_segment_command";
      readonly workspace: string;
      readonly environment: "sandbox" | "production";
      readonly operation_id: string;
      readonly resource_id: string;
    }
  | {
      readonly kind: "run_command";
      readonly command: string;
      readonly retry_mutation: false;
    };

interface BroadcastRecoveryCommand {
  readonly kind: string;
  readonly workspace?: string;
  readonly environment?: "sandbox" | "production";
  readonly broadcastId?: string;
  readonly draftId?: string;
}

interface ReceiptWithEffect {
  readonly core_effect: string;
  readonly next_action?: OperatorNextAction;
}

export function withAmbiguousBroadcastRecovery<
  Receipt extends ReceiptWithEffect,
>(command: BroadcastRecoveryCommand, receipt: Receipt): Receipt {
  if (receipt.core_effect !== "unknown") return receipt;
  const nextAction = ambiguousNextAction(command);
  if (!nextAction) return receipt;
  return {
    ...receipt,
    next_action: nextAction,
  };
}

export function renderAmbiguousBroadcastRecovery(
  receipt: ReceiptWithEffect,
): readonly string[] {
  if (receipt.core_effect !== "unknown" || !receipt.next_action) return [];
  if (receipt.next_action.kind === "read_campaign_command") {
    return [
      `Authoritative readback: fonte campaign receipt --workspace ${argument(receipt.next_action.workspace)} --environment ${receipt.next_action.environment} --operation-id ${argument(receipt.next_action.operation_id)} --json.`,
      `Campaign ID: ${receipt.next_action.resource_id}.`,
      "Retry mutation: false.",
      "Do not retry the mutation.",
    ];
  }
  if (receipt.next_action.kind === "read_segment_command") {
    return [
      `Authoritative readback: fonte segment receipt --workspace ${argument(receipt.next_action.workspace)} --environment ${receipt.next_action.environment} --operation-id ${argument(receipt.next_action.operation_id)} --json.`,
      `Segment ID: ${receipt.next_action.resource_id}.`,
      "Retry mutation: false.",
      "Do not retry the mutation.",
    ];
  }
  return [
    `Authoritative readback: ${receipt.next_action.command}.`,
    "Retry mutation: false.",
    "Do not retry the mutation.",
  ];
}

function ambiguousNextAction(
  command: BroadcastRecoveryCommand,
): OperatorNextAction | null {
  if (
    command.kind === "broadcast_canonical_control" &&
    command.workspace &&
    command.draftId
  ) {
    return runCommand(
      `fonte broadcast send status --workspace ${argument(command.workspace)} --environment production --draft-id ${argument(command.draftId)} --json`,
    );
  }
  if (
    (command.kind === "broadcast_canary" ||
      command.kind === "broadcast_control") &&
    command.workspace &&
    command.broadcastId
  ) {
    return runCommand(
      `fonte broadcast status --workspace ${argument(command.workspace)} --environment production --broadcast-id ${argument(command.broadcastId)} --json`,
    );
  }
  return null;
}

function runCommand(command: string): OperatorNextAction {
  return { kind: "run_command", command, retry_mutation: false };
}

function argument(value: string): string {
  if (/^[A-Za-z0-9._:@/-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
