import {
  invalidProductionArguments,
  operatorArguments,
  positiveInteger,
  productionRead,
  required,
  uuid,
  workspace,
} from "./operator-production-options.js";
import type { ParsedOperatorArguments } from "./operator-types.js";
import { parseProductionOptions } from "./operator-production-options.js";
import { sendPreparedBroadcastInputSchema } from "./mcp-broadcast-paved-types.js";

export function parseBroadcastSendInstructionArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "broadcast" || argv[1] !== "send") return null;
  if (argv[2]?.startsWith("--")) return canonicalSend(argv.slice(2));
  if (argv[2] === "now") return acceptNow(argv.slice(3));
  if (argv[2] === "schedule") return schedule(argv.slice(3));
  if (argv[2] === "status") return status(argv.slice(3));
  if (argv[2] === "replace-schedule") return replaceSchedule(argv.slice(3));
  if (argv[2] === "cancel") return cancel(argv.slice(3));
  if (argv[2] === "increase-limit") return increaseLimit(argv.slice(3));
  invalidProductionArguments("invalid_field", "broadcast send command");
}

function acceptNow(argv: readonly string[]): ParsedOperatorArguments {
  const options = baseMutation(argv, ["--expected-version"]);
  return operatorArguments(options, {
    kind: "broadcast_send_now",
    workspace: workspace(options),
    draftId: draftId(options),
    requestId: requestId(options),
    expectedDraftVersion: positiveInteger(
      required(options, "--expected-version"),
      "--expected-version",
    ),
  });
}

function schedule(argv: readonly string[]): ParsedOperatorArguments {
  const options = baseMutation(argv, ["--expected-version", "--not-before"]);
  return operatorArguments(options, {
    kind: "broadcast_schedule",
    workspace: workspace(options),
    draftId: draftId(options),
    requestId: requestId(options),
    expectedDraftVersion: positiveInteger(
      required(options, "--expected-version"),
      "--expected-version",
    ),
    notBefore: instant(required(options, "--not-before"), "--not-before"),
  });
}

function status(argv: readonly string[]): ParsedOperatorArguments {
  const options = productionRead(argv, ["--draft-id"]);
  return operatorArguments(options, {
    kind: "broadcast_canonical_status",
    workspace: workspace(options),
    draftId: draftId(options),
  });
}

function canonicalSend(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseProductionOptions(argv, ["--send-input"]);
  let candidate: unknown;
  try { candidate = JSON.parse(required(options, "--send-input")); }
  catch { invalidProductionArguments("invalid_field", "--send-input"); }
  const parsed = sendPreparedBroadcastInputSchema.safeParse(candidate);
  if (!parsed.success) invalidProductionArguments("invalid_field", "--send-input");
  return operatorArguments(options, { kind: "broadcast_canonical_send",
    workspace: parsed.data.workspace, sendInput: parsed.data });
}

function replaceSchedule(argv: readonly string[]): ParsedOperatorArguments {
  const options = baseMutation(argv, [
    "--expected-instruction-generation",
    "--expected-version",
    "--not-before",
  ]);
  return operatorArguments(options, {
    kind: "broadcast_schedule_replace",
    workspace: workspace(options),
    draftId: draftId(options),
    requestId: requestId(options),
    expectedInstructionGeneration: generation(
      options,
      "--expected-instruction-generation",
    ),
    expectedDraftVersion: positiveInteger(
      required(options, "--expected-version"),
      "--expected-version",
    ),
    notBefore: instant(required(options, "--not-before"), "--not-before"),
  });
}

function cancel(argv: readonly string[]): ParsedOperatorArguments {
  const options = baseMutation(argv, ["--expected-instruction-generation"]);
  return operatorArguments(options, {
    kind: "broadcast_send_cancel",
    workspace: workspace(options),
    draftId: draftId(options),
    requestId: requestId(options),
    expectedInstructionGeneration: generation(
      options,
      "--expected-instruction-generation",
    ),
  });
}

function increaseLimit(argv: readonly string[]): ParsedOperatorArguments {
  const options = baseMutation(argv, [
    "--expected-instruction-generation",
    "--expected-approval-generation",
  ]);
  return operatorArguments(options, {
    kind: "broadcast_spend_limit_increase",
    workspace: workspace(options),
    draftId: draftId(options),
    requestId: requestId(options),
    expectedInstructionGeneration: generation(
      options,
      "--expected-instruction-generation",
    ),
    expectedApprovalGeneration: generation(
      options,
      "--expected-approval-generation",
    ),
  });
}

function baseMutation(argv: readonly string[], extra: readonly string[]) {
  return productionRead(argv, ["--draft-id", "--request-id", ...extra]);
}

function draftId(options: Parameters<typeof workspace>[0]): string {
  return uuid(required(options, "--draft-id"), "--draft-id");
}

function requestId(options: Parameters<typeof workspace>[0]): string {
  return uuid(required(options, "--request-id"), "--request-id");
}

function generation(
  options: Parameters<typeof workspace>[0],
  field: string,
): number {
  return positiveInteger(required(options, field), field);
}

function instant(value: string, field: string): string {
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalidProductionArguments("invalid_field", field);
  }
  return value;
}
