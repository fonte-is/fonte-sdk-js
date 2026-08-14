import type {
  CommandRunner,
  DependencyPosture,
  ProjectProfile,
} from "./runtime-types.js";
import {
  INSTALL_COMMAND,
  RECONCILE_COMMAND,
  SDK_PACKAGE,
  SDK_VERSION,
  UNINSTALL_COMMAND,
} from "./constants.js";
import { CliBlockedError, CliExecutionError } from "./errors.js";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Return absent or exact; throw dependency_version_conflict otherwise. */
export function dependencyPosture(profile: ProjectProfile): DependencyPosture {
  const occurrences = dependencySections.flatMap((section) => {
    const value = profile.package_manifest[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const version = (value as Record<string, unknown>)[SDK_PACKAGE];
    return version === undefined ? [] : [{ section, version }];
  });
  if (occurrences.length === 0) return "absent";
  if (
    occurrences.length !== 1 ||
    occurrences[0]!.section !== "dependencies" ||
    occurrences[0]!.version !== SDK_VERSION
  ) {
    throw new CliBlockedError("dependency_version_conflict");
  }
  return "exact";
}

export async function installSdk(
  profile: ProjectProfile,
  runner: CommandRunner,
): Promise<void> {
  if (
    (await runner.run(
      "npm",
      commandFor(profile, INSTALL_COMMAND),
      profile.root,
    )) !== 0
  ) {
    throw new CliExecutionError("execution_failed");
  }
}

export async function uninstallSdk(
  profile: ProjectProfile,
  runner: CommandRunner,
): Promise<void> {
  if (
    (await runner.run(
      "npm",
      commandFor(profile, UNINSTALL_COMMAND),
      profile.root,
    )) !== 0
  ) {
    throw new CliExecutionError("execution_failed");
  }
}

export async function reconcileNpm(
  profile: ProjectProfile,
  runner: CommandRunner,
): Promise<void> {
  if (
    (await runner.run(
      "npm",
      commandFor(profile, RECONCILE_COMMAND),
      profile.root,
    )) !== 0
  ) {
    throw new CliExecutionError("rollback_failed");
  }
}

function commandFor(
  profile: ProjectProfile,
  command: readonly string[],
): readonly string[] {
  return profile.package_lock_present
    ? command
    : [...command, "--package-lock=false"];
}
