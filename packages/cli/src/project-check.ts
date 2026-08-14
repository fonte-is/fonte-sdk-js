import type { CommandRunner, ProjectProfile } from "./runtime-types.js";

/** Prefer typecheck; otherwise build; block when absent or nonzero. */
export async function runProjectCheck(
  _profile: ProjectProfile,
  _runner: CommandRunner,
): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}
