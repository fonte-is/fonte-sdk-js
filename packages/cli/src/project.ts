import type { ProjectProfile } from "./runtime-types.js";

/** Detect only the npm + Next.js App Router profile declared in CONTRACT.md. */
export async function detectProject(_root: string): Promise<ProjectProfile> {
  throw new Error("fonte_cli_frame_incomplete");
}
