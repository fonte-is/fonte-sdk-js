import type { IgnorePosture } from "./runtime-types.js";
import path from "node:path";

import { IGNORE_BLOCK_TEXT, IGNORE_PATH } from "./constants.js";
import { readOptional, writeAtomic } from "./filesystem.js";

const exactIgnoreLines = new Set([".fonte/", "/.fonte/"]);

const occurrences = (text: string, value: string): number =>
  text.split(value).length - 1;

/** Recognize only complete /.fonte/ or .fonte/ lines and the exact owned block. */
export async function inspectIgnore(root: string): Promise<IgnorePosture> {
  const bytes = await readOptional(path.join(root, IGNORE_PATH));
  if (!bytes) return { ignored: false, owned: false };
  const text = Buffer.from(bytes).toString("utf8");
  const owned = occurrences(text, IGNORE_BLOCK_TEXT) === 1;
  const ignored =
    owned || text.split(/\r?\n/u).some((line) => exactIgnoreLines.has(line));
  return { ignored, owned };
}

/** Append the exact block, inserting one newline first only when required. */
export async function appendIgnoreBlock(root: string): Promise<void> {
  const target = path.join(root, IGNORE_PATH);
  const bytes = await readOptional(target);
  const text = bytes ? Buffer.from(bytes).toString("utf8") : "";
  if ((await inspectIgnore(root)).ignored) return;
  const separator = text && !text.endsWith("\n") ? "\n" : "";
  await writeAtomic(target, `${text}${separator}${IGNORE_BLOCK_TEXT}`);
}

/** Remove exactly one owned block and preserve every unrelated byte. */
export async function removeIgnoreBlock(root: string): Promise<void> {
  const target = path.join(root, IGNORE_PATH);
  const bytes = await readOptional(target);
  if (!bytes) throw new Error("managed_ignore_missing");
  const text = Buffer.from(bytes).toString("utf8");
  if (occurrences(text, IGNORE_BLOCK_TEXT) !== 1) {
    throw new Error("managed_ignore_drifted");
  }
  await writeAtomic(target, text.replace(IGNORE_BLOCK_TEXT, ""));
}
