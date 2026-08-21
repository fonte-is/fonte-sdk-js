import type { CliUsageError } from "./errors.js";
import { operatorRecoveryCommand } from "./operator-help.js";
import type { InvalidInvocationReceipt } from "./types.js";

/** A JSON request is always answered with one machine-readable receipt. */
export function invalidInvocationReceipt(
  error: CliUsageError,
  argv: readonly string[],
): InvalidInvocationReceipt {
  return {
    schema_version: "fonte.cli.invalid_invocation.v1",
    command: "invalid_invocation",
    outcome: "invalid_invocation",
    reason: "invalid_invocation",
    detail: {
      code: error.code,
      kind: error.detail.kind,
      field: error.detail.field,
    },
    next_action: {
      kind: "run_command",
      command: operatorRecoveryCommand(argv),
    },
  };
}
