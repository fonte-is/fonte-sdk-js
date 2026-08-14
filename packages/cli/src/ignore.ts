import type { IgnorePosture } from "./runtime-types.js";

/** Recognize only complete /.fonte/ or .fonte/ lines and the exact owned block. */
export async function inspectIgnore(_root: string): Promise<IgnorePosture> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Append the exact block, inserting one newline first only when required. */
export async function appendIgnoreBlock(_root: string): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Remove exactly one owned block and preserve every unrelated byte. */
export async function removeIgnoreBlock(_root: string): Promise<void> {
  throw new Error("fonte_cli_frame_incomplete");
}
