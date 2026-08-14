import { rm } from "node:fs/promises";

import {
  IGNORE_PATH,
  LOCAL_MANIFEST_PATH,
  MANAGED_SOURCE_PATH,
  MANAGED_SOURCE_TEXT,
} from "./constants.js";
import { installSdk, uninstallSdk } from "./dependency.js";
import { verifyInstallation } from "./doctor.js";
import { CliBlockedError } from "./errors.js";
import { captureSnapshots, writeExclusiveAtomic } from "./filesystem.js";
import {
  appendIgnoreBlock,
  inspectIgnore,
  removeIgnoreBlock,
} from "./ignore.js";
import {
  assertSourceStillExact,
  manifestForPlan,
  operationActs,
} from "./installation-state.js";
import { readManifest, serializeManifest } from "./manifest.js";
import { assertManagedPathSafe } from "./paths.js";
import { createInitPlan, createRemovePlan } from "./plan.js";
import { detectProject } from "./project.js";
import { preparedReceipt, removedReceipt } from "./receipts.js";
import { removeEmptyDirectories, rollback } from "./rollback.js";
import type { CommandRunner, ProjectProfile } from "./runtime-types.js";
import type { CliReceipt, InstallationPlan } from "./types.js";

const snapshotPaths = [
  "package.json",
  "package-lock.json",
  MANAGED_SOURCE_PATH,
  IGNORE_PATH,
  LOCAL_MANIFEST_PATH,
] as const;

/** Apply init transactionally, create the manifest last, then run doctor. */
export async function applyInit(
  profile: ProjectProfile,
  plan: InstallationPlan,
  installationId: string,
  runner: CommandRunner,
): Promise<CliReceipt> {
  let current = await detectProject(profile.root);
  const currentPlan = await createInitPlan(current);
  if (currentPlan.plan_sha256 !== plan.plan_sha256) {
    throw new CliBlockedError("managed_code_drifted");
  }
  const snapshots = await captureSnapshots(profile.root, snapshotPaths);
  const addDependency = operationActs(plan, "sdk_dependency", "add");
  try {
    if (addDependency) {
      await installSdk(current, runner);
      current = await detectProject(profile.root);
    }
    const sourcePath = await assertManagedPathSafe(
      profile.root,
      MANAGED_SOURCE_PATH,
    );
    await writeExclusiveAtomic(sourcePath, MANAGED_SOURCE_TEXT);
    if (operationActs(plan, "local_state_ignore", "add")) {
      await appendIgnoreBlock(profile.root);
    }
    const manifest = manifestForPlan(plan, installationId);
    const manifestPath = await assertManagedPathSafe(
      profile.root,
      LOCAL_MANIFEST_PATH,
    );
    await writeExclusiveAtomic(
      manifestPath,
      serializeManifest(manifest),
      0o600,
    );
    await verifyInstallation(current, manifest, runner);
    return preparedReceipt("init", plan, "applied");
  } catch (error) {
    await rollback(profile, snapshots, runner, addDependency);
    throw error;
  }
}

/** Remove only validated owned operations, with full preflight and rollback. */
export async function applyRemove(
  profile: ProjectProfile,
  plan: InstallationPlan,
  runner: CommandRunner,
): Promise<CliReceipt> {
  const current = await detectProject(profile.root);
  const manifest = await readManifest(profile.root);
  const currentPlan = await createRemovePlan(current, manifest);
  if (currentPlan.plan_sha256 !== plan.plan_sha256) {
    throw new CliBlockedError("managed_code_drifted");
  }
  const snapshots = await captureSnapshots(profile.root, snapshotPaths);
  const removeDependency = operationActs(plan, "sdk_dependency", "remove");
  try {
    if (removeDependency) await uninstallSdk(current, runner);
    await assertSourceStillExact(profile.root, manifest);
    await rm(await assertManagedPathSafe(profile.root, MANAGED_SOURCE_PATH));
    if (operationActs(plan, "local_state_ignore", "remove")) {
      if (!(await inspectIgnore(profile.root)).owned) {
        throw new CliBlockedError("managed_code_drifted");
      }
      await removeIgnoreBlock(profile.root);
    }
    await rm(await assertManagedPathSafe(profile.root, LOCAL_MANIFEST_PATH));
    await removeEmptyDirectories(profile.root);
    return removedReceipt(plan);
  } catch (error) {
    await rollback(profile, snapshots, runner, removeDependency);
    throw error;
  }
}
