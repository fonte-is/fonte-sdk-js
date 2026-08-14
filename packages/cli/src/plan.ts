import { canonicalJson } from "./canonical-json.js";
import { sha256 } from "./digests.js";
import { createInitMaterial } from "./plan-material.js";
import type {
  InstallationPlan,
  InstallationPlanMaterial,
  LocalManifest,
} from "./types.js";

/** Add the canonical digest without changing operation order. */
export function sealPlan(material: InstallationPlanMaterial): InstallationPlan {
  return { ...material, plan_sha256: sha256(canonicalJson(material)) };
}

export function initPlanFromManifest(
  manifest: LocalManifest,
): InstallationPlan {
  const ids = new Set(manifest.managed_operations.map(({ id }) => id));
  return sealPlan(
    createInitMaterial(
      ids.has("sdk_dependency"),
      ids.has("local_state_ignore"),
    ),
  );
}
