import {
  IGNORE_BLOCK_TEXT,
  IGNORE_PATH,
  LOCAL_MANIFEST_PATH,
  MANAGED_SOURCE_PATH,
  MANAGED_SOURCE_TEXT,
} from "./constants.js";
import { dependencyPosture } from "./dependency.js";
import { sha256 } from "./digests.js";
import { CliBlockedError } from "./errors.js";
import { readOptional } from "./filesystem.js";
import { inspectIgnore } from "./ignore.js";
import { assertManagedPathSafe } from "./paths.js";
import { createInitMaterial, createRemoveMaterial } from "./plan-material.js";
import { initPlanFromManifest, sealPlan } from "./plan.js";
import type { ProjectProfile } from "./runtime-types.js";
import type { InstallationPlan, LocalManifest } from "./types.js";

export async function createInitPlan(
  profile: ProjectProfile,
): Promise<InstallationPlan> {
  const dependency = dependencyPosture(profile);
  const sourcePath = await assertManagedPathSafe(
    profile.root,
    MANAGED_SOURCE_PATH,
  );
  await assertManagedPathSafe(profile.root, IGNORE_PATH);
  await assertManagedPathSafe(profile.root, LOCAL_MANIFEST_PATH);
  if (await readOptional(sourcePath)) {
    throw new CliBlockedError("existing_unmanaged_path");
  }
  const ignore = await inspectIgnore(profile.root);
  return sealPlan(createInitMaterial(dependency === "absent", !ignore.ignored));
}

export async function createRemovePlan(
  profile: ProjectProfile,
  manifest: LocalManifest,
): Promise<InstallationPlan> {
  const owned = new Map(
    manifest.managed_operations.map((item) => [item.id, item]),
  );
  if (initPlanFromManifest(manifest).plan_sha256 !== manifest.plan_sha256) {
    throw new CliBlockedError("installation_manifest_invalid");
  }
  try {
    if (dependencyPosture(profile) !== "exact") throw new Error("absent");
  } catch {
    throw new CliBlockedError("managed_code_drifted");
  }
  const source = owned.get("installation_module");
  const sourcePath = await assertManagedPathSafe(
    profile.root,
    MANAGED_SOURCE_PATH,
  );
  const sourceBytes = await readOptional(sourcePath);
  if (
    source?.kind !== "created_file" ||
    source.sha256 !== sha256(MANAGED_SOURCE_TEXT) ||
    !sourceBytes ||
    sha256(sourceBytes) !== source.sha256
  ) {
    throw new CliBlockedError("managed_code_drifted");
  }
  const ignore = await inspectIgnore(profile.root);
  const ownedIgnore = owned.get("local_state_ignore");
  if (
    (ownedIgnore &&
      (ownedIgnore.kind !== "managed_block" ||
        ownedIgnore.sha256 !== sha256(IGNORE_BLOCK_TEXT) ||
        !ignore.owned)) ||
    (!ownedIgnore && !ignore.ignored)
  ) {
    throw new CliBlockedError("managed_code_drifted");
  }
  const operations = [];
  if (owned.has("sdk_dependency")) {
    operations.push({
      id: "sdk_dependency",
      kind: "dependency" as const,
      path: "package.json",
      action: "remove" as const,
    });
  }
  operations.push({
    id: "installation_module",
    kind: "create_file" as const,
    path: MANAGED_SOURCE_PATH,
    action: "remove" as const,
    sha256: source.sha256,
  });
  if (ownedIgnore) {
    operations.push({
      id: "local_state_ignore",
      kind: "managed_block" as const,
      path: IGNORE_PATH,
      action: "remove" as const,
      sha256: ownedIgnore.sha256,
    });
  }
  operations.push({
    id: "local_manifest",
    kind: "create_local_manifest" as const,
    path: LOCAL_MANIFEST_PATH,
    action: "remove" as const,
  });
  return sealPlan(createRemoveMaterial(operations));
}
