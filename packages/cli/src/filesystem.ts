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
    const metadata = bytes ? await lstat(target, { bigint: true }) : null;
    if (metadata && !metadata.isFile())
      throw new Error("managed_path_not_file");
    snapshots.push(
      bytes
        ? {
            path: relativePath,
            existed: true,
            bytes,
            mode: Number(metadata!.mode),
            device: metadata!.dev,
            inode: metadata!.ino,
          }
        : { path: relativePath, existed: false },
    );
  }
  return snapshots;
}

/** Restore exact snapshots atomically; delete only paths absent in the snapshot. */
export async function restoreSnapshots(
  root: string,
  originals: readonly FileSnapshot[],
  expectedCurrent: readonly FileSnapshot[],
): Promise<void> {
  const originalByPath = new Map(
    originals.map((snapshot) => [snapshot.path, snapshot]),
  );
  for (const expected of expectedCurrent) {
    const original = originalByPath.get(expected.path);
    if (!original) throw new Error("snapshot_original_missing");
    const [current] = await captureSnapshots(root, [expected.path]);
    if (!current || !sameSnapshot(current, expected)) {
      throw new Error("snapshot_current_drifted");
    }
    const target = await assertManagedPathSafe(root, original.path);
    if (original.existed) {
      await writeAtomic(target, original.bytes!, original.mode);
    } else {
      await rm(target, { force: true });
    }
  }
}

export async function assertSnapshotsCurrent(
  root: string,
  expected: readonly FileSnapshot[],
  paths: readonly string[],
): Promise<void> {
  const byPath = new Map(expected.map((snapshot) => [snapshot.path, snapshot]));
  for (const current of await captureSnapshots(root, paths)) {
    const prior = byPath.get(current.path);
    if (!prior || !sameSnapshot(current, prior))
      throw new Error("snapshot_current_drifted");
  }
}

function sameSnapshot(left: FileSnapshot, right: FileSnapshot): boolean {
  if (left.existed !== right.existed) return false;
  if (!left.existed) return true;
  return (
    left.mode === right.mode &&
    left.device === right.device &&
    left.inode === right.inode &&
    Buffer.from(left.bytes!).equals(Buffer.from(right.bytes!))
  );
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

export async function writeExclusiveManaged(
  root: string,
  relativePath: string,
  bytes: string | Uint8Array,
  mode = 0o644,
): Promise<void> {
  const target = await assertManagedPathSafe(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  if ((await assertManagedPathSafe(root, relativePath)) !== target) {
    throw new Error("managed_path_changed");
  }
  const temporary = temporaryPath(target);
  try {
    await writeTemporary(temporary, bytes, mode);
    if ((await assertManagedPathSafe(root, relativePath)) !== target) {
      throw new Error("managed_path_changed");
    }
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
