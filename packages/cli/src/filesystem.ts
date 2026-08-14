import type { FileSnapshot } from "./runtime-types.js";

/** Return null only for ENOENT; propagate every other read failure. */
export async function readOptional(_path: string): Promise<Uint8Array | null> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Snapshot exact bytes and mode for normalized managed relative paths. */
export async function captureSnapshots(
  _root: string,
  _paths: readonly string[],
): Promise<FileSnapshot[]> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Restore exact snapshots atomically; delete only paths absent in the snapshot. */
export async function restoreSnapshots(
  _root: string,
  _snapshots: readonly FileSnapshot[],
): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Write through a same-directory temporary file and atomic rename. */
export async function writeAtomic(
  _path: string,
  _bytes: string | Uint8Array,
  _mode?: number,
): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}
