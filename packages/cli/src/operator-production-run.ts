import type { CoreOperatorClient } from "./operator-client.js";
import { CoreOperatorError } from "./operator-client.js";
import type {
  OperatorCommand,
  OperatorReceipt,
  OperatorResult,
} from "./operator-types.js";

type ProductionOperatorCommand = Extract<
  OperatorCommand,
  {
    readonly kind:
      | "broadcast_draft_create"
      | "broadcast_draft_read"
      | "broadcast_audience_options"
      | "broadcast_audience_preview"
      | "broadcast_production_test_send"
      | "broadcast_production_test_status"
      | "broadcast_authorize"
      | "broadcast_progress"
      | "broadcast_control"
      | "broadcast_result";
  }
>;

export interface ProductionReceiptDescriptor {
  readonly outcome: "queued" | "terminal" | "completed" | "blocked";
  readonly reason: string;
  readonly coreEffect: Exclude<OperatorReceipt["core_effect"], "unknown">;
}

export function isProductionCommand(
  command: OperatorCommand,
): command is ProductionOperatorCommand {
  return (
    command.kind !== "unsupported" &&
    command.kind !== "broadcast_test_send" &&
    command.kind !== "broadcast_test_status" &&
    command.kind !== "broadcast_preflight" &&
    command.kind !== "bridge_resend_preview" &&
    command.kind !== "bridge_resend_copy"
  );
}

export async function executeProductionCommand(
  command: ProductionOperatorCommand,
  client: CoreOperatorClient,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<OperatorResult> {
  if (command.kind === "broadcast_draft_create") {
    return client.createProductionDraft(command);
  }
  if (command.kind === "broadcast_draft_read") {
    return client.readProductionDraft(command);
  }
  if (command.kind === "broadcast_audience_options") {
    return client.listProductionAudienceOptions(command);
  }
  if (command.kind === "broadcast_audience_preview") {
    return client.previewProductionAudience(command);
  }
  if (command.kind === "broadcast_production_test_send") {
    return client.sendProductionTest(command);
  }
  if (command.kind === "broadcast_production_test_status") {
    const read = () => client.readProductionTest(command);
    return command.watch ? pollTest(read, sleep) : read();
  }
  if (command.kind === "broadcast_authorize") {
    return client.authorizeProductionBroadcast(command);
  }
  if (command.kind === "broadcast_progress") {
    const read = () => client.readProductionProgress(command);
    return command.watch ? pollProgress(read, sleep) : read();
  }
  if (command.kind === "broadcast_control") {
    return client.controlProductionBroadcast(command);
  }
  return client.readProductionResult(command);
}

export function productionReceiptDescriptor(
  command: Exclude<OperatorCommand, { readonly kind: "unsupported" }>,
  result: OperatorResult,
): ProductionReceiptDescriptor | null {
  if (result.kind === "broadcast_draft") {
    return {
      outcome: "completed",
      reason:
        result.outcome === "applied"
          ? "broadcast_draft_created"
          : result.outcome === "no_change"
            ? "broadcast_draft_idempotent"
            : "broadcast_draft_observed",
      coreEffect: result.outcome === "applied" ? "created" : "none",
    };
  }
  if (
    result.kind === "broadcast_audience_options" ||
    result.kind === "broadcast_audience_preview"
  ) {
    return {
      outcome: "completed",
      reason: `${result.kind}_observed`,
      coreEffect: "none",
    };
  }
  if (
    result.kind === "broadcast_test_queued" ||
    result.kind === "broadcast_authorization"
  ) {
    return {
      outcome: "queued",
      reason: result.replayed
        ? `${result.kind}_idempotent`
        : `${result.kind}_queued`,
      coreEffect: result.replayed ? "none" : "queued",
    };
  }
  if (result.kind === "production_test") {
    return {
      outcome:
        result.status === "terminal"
          ? "terminal"
          : result.status === "unknown"
            ? "blocked"
            : "completed",
      reason: `production_test_${result.status}`,
      coreEffect: "none",
    };
  }
  if (result.kind === "broadcast_progress") {
    return {
      outcome: result.status === "terminal" ? "terminal" : "completed",
      reason: `broadcast_progress_${result.status}`,
      coreEffect: command.kind === "broadcast_control" ? "controlled" : "none",
    };
  }
  if (result.kind === "broadcast_result") {
    return {
      outcome: result.status === "terminal" ? "terminal" : "completed",
      reason: `broadcast_result_${result.status}`,
      coreEffect: "none",
    };
  }
  return null;
}

async function pollTest(
  read: () => ReturnType<CoreOperatorClient["readProductionTest"]>,
  sleep: (milliseconds: number) => Promise<void>,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await read();
    if (result.status !== "processing") return result;
    await sleep(Math.min(result.poll_after_milliseconds ?? 1_000, 2_000));
  }
  throw new CoreOperatorError("core_readback_timeout", null, "none");
}

async function pollProgress(
  read: () => ReturnType<CoreOperatorClient["readProductionProgress"]>,
  sleep: (milliseconds: number) => Promise<void>,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await read();
    if (result.status !== "processing") return result;
    await sleep(2_000);
  }
  throw new CoreOperatorError("core_readback_timeout", null, "none");
}
