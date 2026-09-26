import {
  parseBroadcastArguments,
  renderBroadcastCommand,
  runBroadcastCommand,
} from "./broadcast-command.js";
import { createAuthenticatedBroadcastProvider } from "./broadcast-runtime.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import { CoreOperatorError } from "./operator-core-request.js";
import type { CommandResult, ProgramDependencies } from "./runtime-types.js";

/** Takes only replacement review/Send commands; schedule/control remain in their existing parser. */
export async function runBroadcastProgram(
  argv: readonly string[],
  dependencies: ProgramDependencies,
): Promise<CommandResult | null> {
  if (argv.includes("--help")) return null;
  let command;
  try {
    command = parseBroadcastArguments(argv);
  } catch (error) {
    const result = {
      ...sequenceMcpFailure(error),
      request_id: null,
      operation: null,
    };
    return {
      exitCode: 2,
      stdout: renderBroadcastCommand(result, argv.includes("--json")),
      stderr: "",
    };
  }
  if (command === null) return null;
  try {
    const provider =
      dependencies.broadcast ??
      (dependencies.operator
        ? createAuthenticatedBroadcastProvider({
            ...dependencies.operator,
            fetch: (input, init) => {
              // This boundary's hosted-config and Core requesters send URL inputs only.
              if (input instanceof Request)
                throw new CoreOperatorError(
                  "core_request_invalid",
                  null,
                  "none",
                );
              return dependencies.operator!.fetch(input, init);
            },
            now: dependencies.operator.now
              ? () => dependencies.operator!.now!().getTime()
              : undefined,
          })
        : null);
    if (!provider) throw new Error("broadcast_runtime_unavailable");
    const result = await runBroadcastCommand(command, await provider());
    const operation = result.operation;
    const blocked =
      operation === null ||
      ("state" in operation
        ? operation.state === "failed" || operation.state === "cancelled"
        : operation.outcome === "action_required" ||
          operation.outcome === "rejected");
    return {
      exitCode: blocked ? 3 : 0,
      stdout: renderBroadcastCommand(result, command.json),
      stderr: "",
    };
  } catch (error) {
    const result = {
      ...sequenceMcpFailure(error),
      request_id: null,
      operation: null,
    };
    return {
      exitCode: 3,
      stdout: renderBroadcastCommand(result, command.json),
      stderr: "",
    };
  }
}
