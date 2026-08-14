import type { ProjectProfile } from "./runtime-types.js";
import type {
  InstallationPlan,
  InstallationPlanMaterial,
  LocalManifest,
} from "./types.js";

/** Add the canonical digest without changing operation order. */
export function sealPlan(
  _material: InstallationPlanMaterial,
): InstallationPlan {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Produce the exact ordered init operations declared in CONTRACT.md. */
export async function createInitPlan(
  _profile: ProjectProfile,
): Promise<InstallationPlan> {
  throw new Error("fonte_cli_frame_incomplete");
}

/** Invert only operations owned by the validated manifest. */
export async function createRemovePlan(
  _profile: ProjectProfile,
  _manifest: LocalManifest,
): Promise<InstallationPlan> {
  throw new Error("fonte_cli_frame_incomplete");
}
