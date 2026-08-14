import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { FileSnapshot } from "./runtime-types.js";
import { assertManagedPathSafe } from "./paths.js";

/** Return null only for ENOENT; propagate every other read failure. */
export async function readOptional(target: string): Promise<Uint8Array | null> {
  return readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** Snapshot exact bytes and mode for normalized managed relative paths. */
export async function captureSnapshots(
  root: string,
  paths: readonly string[],
): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];
  for (const relativePath of paths) {
    const target = await assertManagedPathSafe(root, relativePath);
    const bytes = await readOptional(target);
    const metadata = bytes ? await lstat(target) : null;
    if (metadata && !metadata.isFile())
      throw new Error("managed_path_not_file");
    snapshots.push(
      bytes
        ? { path: relativePath, existed: true, bytes, mode: metadata!.mode }
        : { path: relativePath, existed: false },
    );
  }
  return snapshots;
}

/** Restore exact snapshots atomically; delete only paths absent in the snapshot. */
export async function restoreSnapshots(
  root: string,
  snapshots: readonly FileSnapshot[],
): Promise<void> {
  for (const snapshot of snapshots) {
    const target = await assertManagedPathSafe(root, snapshot.path);
    if (snapshot.existed) {
      await writeAtomic(target, snapshot.bytes!, snapshot.mode);
    } else {
      await rm(target, { force: true });
    }
  }
}

/** Write through a same-directory temporary file and atomic rename. */
export async function writeAtomic(
  target: string,
  bytes: string | Uint8Array,
  mode = 0o644,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = temporaryPath(target);
  try {
    await writeTemporary(temporary, bytes, mode);
    await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function writeExclusiveAtomic(
  target: string,
  bytes: string | Uint8Array,
  mode = 0o644,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = temporaryPath(target);
  try {
    await writeTemporary(temporary, bytes, mode);
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function writeTemporary(
  target: string,
  bytes: string | Uint8Array,
  mode: number,
): Promise<void> {
  const handle = await open(target, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function temporaryPath(target: string): string {
  return `${target}.fonte-${process.pid}-${randomBytes(8).toString("hex")}`;
}
