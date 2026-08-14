import { rmdir } from "node:fs/promises";
import path from "node:path";

import { reconcileNpm } from "./dependency.js";
import { CliExecutionError } from "./errors.js";
import { captureSnapshots, restoreSnapshots } from "./filesystem.js";
import type {
  CommandRunner,
  FileSnapshot,
  ProjectProfile,
} from "./runtime-types.js";

export async function rollback(
  profile: ProjectProfile,
  originals: readonly FileSnapshot[],
  applied: readonly FileSnapshot[],
  runner: CommandRunner,
  reconcile: boolean,
): Promise<void> {
  try {
    await restoreSnapshots(profile.root, originals, applied);
    if (reconcile) {
      await reconcileNpm(profile, runner);
      const reconciled = await captureSnapshots(profile.root, [
        "package.json",
        "package-lock.json",
      ]);
      await restoreSnapshots(profile.root, originals, reconciled);
    }
    await removeEmptyDirectories(profile.root);
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
