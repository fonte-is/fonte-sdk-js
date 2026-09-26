import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

export const BROADCAST_HTML_MAX_BYTES = 262_144;
export const BROADCAST_REFERENCE_MAX_BYTES = 16_777_216;

export interface BroadcastLocalFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export type BroadcastLocalFileReader = (
  filePath: string,
  maximumBytes: number,
) => Promise<BroadcastLocalFile>;

export class BroadcastLocalFileError extends Error {
  public constructor(readonly reason: string) {
    super(reason);
    this.name = "BroadcastLocalFileError";
  }
}

export async function readBroadcastLocalFile(
  filePath: string,
  maximumBytes: number,
): Promise<BroadcastLocalFile> {
  if (!path.isAbsolute(filePath)) {
    throw new BroadcastLocalFileError("broadcast_source_path_not_absolute");
  }
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new BroadcastLocalFileError("broadcast_source_not_regular_file");
    }
    if (metadata.size > maximumBytes) {
      throw new BroadcastLocalFileError("broadcast_source_file_too_large");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) {
      throw new BroadcastLocalFileError("broadcast_source_file_too_large");
    }
    return { path: filePath, bytes };
  } catch (error) {
    if (error instanceof BroadcastLocalFileError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new BroadcastLocalFileError("broadcast_source_file_missing");
    }
    if (code === "ELOOP") {
      throw new BroadcastLocalFileError("broadcast_source_not_regular_file");
    }
    throw new BroadcastLocalFileError("broadcast_source_file_unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
