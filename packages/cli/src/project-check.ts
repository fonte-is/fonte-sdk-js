import type { CommandRunner, ProjectProfile } from "./runtime-types.js";
import { CliBlockedError } from "./errors.js";

/** Prefer typecheck; otherwise build; block when absent or nonzero. */
export async function runProjectCheck(
  profile: ProjectProfile,
  runner: CommandRunner,
): Promise<void> {
  const script = profile.scripts.typecheck
    ? "typecheck"
    : profile.scripts.build
      ? "build"
      : null;
  if (!script) throw new CliBlockedError("project_check_unavailable");
  const exitCode = await runner.run("npm", ["run", script], profile.root);
  if (exitCode !== 0) throw new CliBlockedError("project_check_failed");
}
