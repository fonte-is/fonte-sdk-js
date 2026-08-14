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
import {
  captureSnapshots,
  assertSnapshotsCurrent,
  readOptional,
  writeExclusiveManaged,
} from "./filesystem.js";
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
import { createInitPlan, createRemovePlan } from "./installation-plan.js";
import { readManifest, serializeManifest } from "./manifest.js";
import { recordCurrent, runAndRecord } from "./mutation-journal.js";
import { assertManagedPathSafe } from "./paths.js";
import { detectProject } from "./project.js";
import { preparedReceipt, removedReceipt } from "./receipts.js";
import { removeEmptyDirectories, rollback } from "./rollback.js";
import type {
  CommandRunner,
  FileSnapshot,
  ProjectProfile,
} from "./runtime-types.js";
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
  const applied: FileSnapshot[] = [];
  const addDependency = operationActs(plan, "sdk_dependency", "add");
  try {
    if (addDependency) {
      await runAndRecord(
        () => installSdk(current, runner),
        profile.root,
        ["package.json", "package-lock.json"],
        applied,
      );
      current = await detectProject(profile.root);
    }
    await assertInitTargetsStillCompatible(profile.root, plan);
    await assertUnchanged(profile.root, snapshots, [MANAGED_SOURCE_PATH]);
    await writeExclusiveManaged(
      profile.root,
      MANAGED_SOURCE_PATH,
      MANAGED_SOURCE_TEXT,
    );
    await recordCurrent(profile.root, [MANAGED_SOURCE_PATH], applied);
    if (operationActs(plan, "local_state_ignore", "add")) {
      await assertUnchanged(profile.root, snapshots, [IGNORE_PATH]);
      await appendIgnoreBlock(profile.root);
      await recordCurrent(profile.root, [IGNORE_PATH], applied);
    }
    const manifest = manifestForPlan(plan, installationId);
    await assertUnchanged(profile.root, snapshots, [LOCAL_MANIFEST_PATH]);
    await writeExclusiveManaged(
      profile.root,
      LOCAL_MANIFEST_PATH,
      serializeManifest(manifest),
      0o600,
    );
    await recordCurrent(profile.root, [LOCAL_MANIFEST_PATH], applied);
    await verifyInstallation(current, manifest);
    return preparedReceipt("init", plan, "applied");
  } catch (error) {
    await rollback(profile, snapshots, applied, runner, addDependency);
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
  const applied: FileSnapshot[] = [];
  const removeDependency = operationActs(plan, "sdk_dependency", "remove");
  try {
    if (removeDependency) {
      await runAndRecord(
        () => uninstallSdk(current, runner),
        profile.root,
        ["package.json", "package-lock.json"],
        applied,
      );
    }
    await assertUnchanged(profile.root, snapshots, [MANAGED_SOURCE_PATH]);
    await assertSourceStillExact(profile.root, manifest);
    await rm(await assertManagedPathSafe(profile.root, MANAGED_SOURCE_PATH));
    await recordCurrent(profile.root, [MANAGED_SOURCE_PATH], applied);
    if (operationActs(plan, "local_state_ignore", "remove")) {
      await assertUnchanged(profile.root, snapshots, [IGNORE_PATH]);
      if (!(await inspectIgnore(profile.root)).owned) {
        throw new CliBlockedError("managed_code_drifted");
      }
      await removeIgnoreBlock(profile.root);
      await recordCurrent(profile.root, [IGNORE_PATH], applied);
    }
    await assertUnchanged(profile.root, snapshots, [LOCAL_MANIFEST_PATH]);
    await rm(await assertManagedPathSafe(profile.root, LOCAL_MANIFEST_PATH));
    await recordCurrent(profile.root, [LOCAL_MANIFEST_PATH], applied);
    await removeEmptyDirectories(profile.root);
    return removedReceipt(plan);
  } catch (error) {
    await rollback(profile, snapshots, applied, runner, removeDependency);
    throw error;
  }
}

async function assertUnchanged(
  root: string,
  snapshots: readonly FileSnapshot[],
  paths: readonly string[],
): Promise<void> {
  try {
    await assertSnapshotsCurrent(root, snapshots, paths);
  } catch {
    throw new CliBlockedError("managed_code_drifted");
  }
}

async function assertInitTargetsStillCompatible(
  root: string,
  plan: InstallationPlan,
): Promise<void> {
  const source = await readOptional(
    await assertManagedPathSafe(root, MANAGED_SOURCE_PATH),
  );
  const manifest = await readOptional(
    await assertManagedPathSafe(root, LOCAL_MANIFEST_PATH),
  );
  if (source || manifest) throw new CliBlockedError("managed_code_drifted");
  const ignore = await inspectIgnore(root);
  const expectsAdd = operationActs(plan, "local_state_ignore", "add");
  if (expectsAdd ? ignore.ignored : !ignore.ignored) {
    throw new CliBlockedError("managed_code_drifted");
  }
}
