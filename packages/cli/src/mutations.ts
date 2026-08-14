import type { CommandRunner, ProjectProfile } from "./runtime-types.js";
import type { CliReceipt, InstallationPlan } from "./types.js";

/** Apply init transactionally, create the manifest last, then run doctor. */
export async function applyInit(
  _profile: ProjectProfile,
  _plan: InstallationPlan,
  _installationId: string,
  _runner: CommandRunner,
): Promise<CliReceipt> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Remove only validated owned operations, with full preflight and rollback. */
export async function applyRemove(
  _profile: ProjectProfile,
  _plan: InstallationPlan,
  _runner: CommandRunner,
): Promise<CliReceipt> {
  throw new Error("fonte_cli_frame_incomplete");
}
