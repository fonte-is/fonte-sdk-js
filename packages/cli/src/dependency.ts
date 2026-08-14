import type {
  CommandRunner,
  DependencyPosture,
  ProjectProfile,
} from "./runtime-types.js";

/** Return absent or exact; throw dependency_version_conflict otherwise. */
export function dependencyPosture(_profile: ProjectProfile): DependencyPosture {
  throw new Error("fonte_cli_frame_incomplete");
}

export async function installSdk(
  _profile: ProjectProfile,
  _runner: CommandRunner,
): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}

export async function uninstallSdk(
  _profile: ProjectProfile,
  _runner: CommandRunner,
): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}

export async function reconcileNpm(
  _profile: ProjectProfile,
  _runner: CommandRunner,
): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}
