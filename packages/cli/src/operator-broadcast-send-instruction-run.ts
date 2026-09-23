import type { CoreOperatorClient } from "./operator-client.js";
import type {
  BroadcastSendInstructionOperatorCommand,
  BroadcastSendOperationResult,
} from "./operator-broadcast-send-instruction-types.js";
import type { OperatorCommand, OperatorReceipt } from "./operator-types.js";

export function isBroadcastSendInstructionCommand(
  command: OperatorCommand,
): command is BroadcastSendInstructionOperatorCommand {
  return [
    "broadcast_send_now",
    "broadcast_schedule",
    "broadcast_send_status",
    "broadcast_schedule_replace",
    "broadcast_send_cancel",
    "broadcast_spend_limit_increase",
  ].includes(command.kind);
}

export async function executeBroadcastSendInstructionCommand(
  command: BroadcastSendInstructionOperatorCommand,
  client: CoreOperatorClient,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<BroadcastSendOperationResult> {
  if (command.kind === "broadcast_send_now") {
    return client.acceptBroadcastSend({ ...command, timing: { mode: "now" } });
  }
  if (command.kind === "broadcast_schedule") {
    return client.acceptBroadcastSend({
      ...command,
      timing: { mode: "scheduled", notBefore: command.notBefore },
    });
  }
  if (command.kind === "broadcast_schedule_replace") {
    return client.replaceBroadcastSendSchedule(command);
  }
  if (command.kind === "broadcast_send_cancel") {
    return client.cancelBroadcastSend(command);
  }
  if (command.kind === "broadcast_spend_limit_increase") {
    return client.resolveBroadcastSpendLimit(command);
  }
  const read = () => client.readBroadcastSendOperation(command);
  return command.watch ? poll(read, sleep) : read();
}

export function broadcastSendInstructionReceiptDescriptor(
  command: OperatorCommand,
  result: BroadcastSendOperationResult,
): {
  readonly outcome: "queued" | "terminal" | "completed" | "blocked";
  readonly reason: string;
  readonly coreEffect: OperatorReceipt["core_effect"];
} | null {
  if (!isBroadcastSendInstructionCommand(command)) return null;
  if (result.status === "absent") {
    return {
      outcome: "completed",
      reason: "broadcast_send_operation_absent",
      coreEffect: "none",
    };
  }
  const operation = result.operation;
  const terminal = ["complete", "failed", "canceled"].includes(operation.phase);
  const blocked = ["action_required", "paused", "waiting"].includes(
    operation.phase,
  );
  const mutation = command.kind !== "broadcast_send_status";
  return {
    outcome: terminal
      ? "terminal"
      : blocked
        ? "blocked"
        : ["queued", "scheduled"].includes(operation.phase)
          ? "queued"
          : "completed",
    reason: `broadcast_send_${operation.phase}`,
    coreEffect:
      !mutation || operation.replayed
        ? "none"
        : command.kind === "broadcast_schedule_replace"
          ? "replaced"
          : command.kind === "broadcast_send_cancel"
            ? "controlled"
            : command.kind === "broadcast_spend_limit_increase"
              ? "controlled"
              : "queued",
  };
}

async function poll(
  read: () => Promise<BroadcastSendOperationResult>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<BroadcastSendOperationResult> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await read();
    if (
      result.status === "absent" ||
      ![
        "scheduled",
        "queued",
        "preparing",
        "authorizing",
        "packaging",
        "activation_pending",
        "sending",
        "stopping",
        "canceling",
      ].includes(result.operation.phase)
    )
      return result;
    await sleep(2_000);
  }
  return read();
}
