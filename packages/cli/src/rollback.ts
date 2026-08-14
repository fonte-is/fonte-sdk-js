import { rmdir } from "node:fs/promises";
import path from "node:path";

import { reconcileNpm } from "./dependency.js";
import { CliExecutionError } from "./errors.js";
import { restoreSnapshots } from "./filesystem.js";
import type {
  CommandRunner,
  FileSnapshot,
  ProjectProfile,
} from "./runtime-types.js";

export async function rollback(
  profile: ProjectProfile,
  snapshots: readonly FileSnapshot[],
  runner: CommandRunner,
  reconcile: boolean,
): Promise<void> {
  try {
    await restoreSnapshots(profile.root, snapshots);
    await removeEmptyDirectories(profile.root);
    if (reconcile) await reconcileNpm(profile, runner);
  } catch {
    throw new CliExecutionError("rollback_failed");
  }
}

export async function removeEmptyDirectories(root: string): Promise<void> {
  for (const relative of [".fonte", "fonte"]) {
    await rmdir(path.join(root, relative)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
      },
    );
  }
}
