import type { CommandRunner, ProjectProfile } from "./runtime-types.js";
import type { CliReceipt, LocalManifest } from "./types.js";

/** Verify every doctor invariant in CONTRACT.md without writing. */
export async function verifyInstallation(
  _profile: ProjectProfile,
  _manifest: LocalManifest,
  _runner: CommandRunner,
): Promise<CliReceipt> {
  throw new Error("fonte_cli_frame_incomplete");
}
