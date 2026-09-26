import { EXECUTION_ERROR_TEXT, USAGE_TEXT } from "./constants.js";
import { CliUsageError } from "./errors.js";
import { parseReleaseArguments } from "./release-arguments.js";
import { runReleaseCommand } from "./release-command.js";
import type {
  CapturedCommandRunner,
  CommandOutput,
  CommandResult,
} from "./runtime-types.js";
import type { ParsedArguments } from "./types.js";

/** Release needs Git credentials and the canonical executor, not a Fonte session. */
export async function runReleaseProgram(
  argv: readonly string[],
  cwd: string,
  runner: CapturedCommandRunner,
  output?: CommandOutput,
): Promise<CommandResult> {
  let parsed: ParsedArguments;
  try {
    parsed = parseReleaseArguments(argv.slice(1));
  } catch (error) {
    if (error instanceof CliUsageError) {
      if (argv.includes("--json")) {
        const { invalidInvocationReceipt } =
          await import("./invalid-invocation.js");
        const receipt = invalidInvocationReceipt(error, argv);
        return {
          exitCode: 2,
          stdout: `${JSON.stringify(receipt)}\n`,
          stderr: "",
          receipt,
        };
      }
      return { exitCode: 2, stdout: "", stderr: USAGE_TEXT };
    }
    return { exitCode: 1, stdout: "", stderr: EXECUTION_ERROR_TEXT };
  }
  if (parsed.command === "help")
    return { exitCode: 0, stdout: parsed.helpText!, stderr: "" };
  try {
    return await runReleaseCommand(parsed.releaseSource!, cwd, runner, output);
  } catch {
    return { exitCode: 1, stdout: "", stderr: EXECUTION_ERROR_TEXT };
  }
}
