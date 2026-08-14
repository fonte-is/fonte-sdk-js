import { captureSnapshots } from "./filesystem.js";
import type { FileSnapshot } from "./runtime-types.js";

export async function recordCurrent(
  root: string,
  paths: readonly string[],
  journal: FileSnapshot[],
): Promise<void> {
  for (const snapshot of await captureSnapshots(root, paths)) {
    const index = journal.findIndex(({ path }) => path === snapshot.path);
    if (index === -1) journal.push(snapshot);
    else journal[index] = snapshot;
  }
}

export async function runAndRecord(
  action: () => Promise<void>,
  root: string,
  paths: readonly string[],
  journal: FileSnapshot[],
): Promise<void> {
  try {
    await action();
  } finally {
    await recordCurrent(root, paths, journal);
  }
}
