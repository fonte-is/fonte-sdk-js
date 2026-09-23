import { CoreOperatorError } from "./operator-core-request.js";
import type { SegmentMetadataClient } from "./operator-segment-client.js";
import type {
  SegmentCommandEnvelope,
  SegmentMetadataEnvelope,
  SegmentOperatorCommand,
  SegmentOperatorReceipt,
} from "./operator-segment-types.js";

export interface SegmentReceiptDescriptor {
  readonly outcome: "completed";
  readonly reason: "ok";
  readonly coreEffect: "none" | "created" | "replaced";
}

export function isSegmentCommand(command: {
  readonly kind: string;
}): command is SegmentOperatorCommand {
  return command.kind.startsWith("segment_");
}

export async function executeSegmentCommand(
  command: SegmentOperatorCommand,
  client: SegmentMetadataClient,
): Promise<SegmentMetadataEnvelope> {
  switch (command.kind) {
    case "segment_list":
      return client.list(command);
    case "segment_read":
      return client.read(command);
    case "segment_create":
      return client.create(command);
    case "segment_update":
      return client.update(command);
    case "segment_archive":
      return client.setArchived(command);
    case "segment_receipt":
      return client.readCommand(command);
  }
}

export async function runSegmentOperatorCommand(
  command: SegmentOperatorCommand,
  client: SegmentMetadataClient,
): Promise<SegmentOperatorReceipt> {
  try {
    const result = await executeSegmentCommand(command, client);
    const descriptor = segmentReceiptDescriptor(command, result);
    return {
      schema_version: "fonte.cli.operator_receipt.v1",
      command: command.kind,
      outcome: descriptor.outcome,
      reason: descriptor.reason,
      workspace: command.workspace,
      authority: {
        status: "current",
        contract_id: "fonte.core.native_segment.v1",
      },
      core_effect: descriptor.coreEffect,
      result,
    };
  } catch (error) {
    return segmentFailureReceipt(command, error);
  }
}

export function segmentFailureReceipt(
  command: SegmentOperatorCommand,
  error: unknown,
): SegmentOperatorReceipt {
  const core = error instanceof CoreOperatorError ? error : null;
  const operation =
    command.kind === "segment_create" ||
    command.kind === "segment_update" ||
    command.kind === "segment_archive";
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome: "blocked",
    reason: sanitizedReason(core?.reason),
    workspace: command.workspace,
    authority: {
      status: "current",
      contract_id: "fonte.core.native_segment.v1",
    },
    core_effect: core?.coreEffect ?? "none",
    ...(operation && core?.coreEffect === "unknown"
      ? {
          next_action: {
            kind: "read_segment_command" as const,
            workspace: command.workspace,
            environment: command.environment,
            operation_id: command.operationId,
            resource_id: command.segmentId,
          },
        }
      : {}),
    result: null,
  };
}

export function segmentReceiptDescriptor(
  command: SegmentOperatorCommand,
  result: SegmentMetadataEnvelope,
): SegmentReceiptDescriptor {
  if (
    command.kind === "segment_create" ||
    command.kind === "segment_update" ||
    command.kind === "segment_archive"
  ) {
    const mutation = result as SegmentCommandEnvelope;
    if (mutation.replayed)
      return { outcome: "completed", reason: "ok", coreEffect: "none" };
    return {
      outcome: "completed",
      reason: "ok",
      coreEffect: command.kind === "segment_create" ? "created" : "replaced",
    };
  }
  return { outcome: "completed", reason: "ok", coreEffect: "none" };
}

function sanitizedReason(reason: string | undefined): string {
  return reason && /^[a-z0-9_]{1,100}$/u.test(reason)
    ? reason
    : "operator_request_failed";
}
