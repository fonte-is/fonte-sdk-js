import type { CommandResult, ProgramDependencies } from "./runtime-types.js";

/** Execute one parsed CLI request; never write directly to stdout or stderr. */
export async function runProgram(
  _argv: readonly string[],
  _dependencies: ProgramDependencies,
): Promise<CommandResult> {
  throw new Error("fonte_cli_frame_incomplete");
}
