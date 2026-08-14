import { lstat } from "node:fs/promises";
import path from "node:path";

import { SDK_PACKAGE, SDK_VERSION } from "./constants.js";
import { CliBlockedError } from "./errors.js";
import { readOptional } from "./filesystem.js";
import { createRemovePlan } from "./installation-plan.js";
import { initPlanFromManifest } from "./plan.js";
import { preparedReceipt } from "./receipts.js";
import type { ProjectProfile } from "./runtime-types.js";
import type { CliReceipt, LocalManifest } from "./types.js";

/** Verify every doctor invariant in CONTRACT.md without writing. */
export async function verifyInstallation(
  profile: ProjectProfile,
  manifest: LocalManifest,
): Promise<CliReceipt> {
  await createRemovePlan(profile, manifest);
  await verifyInstalledSdk(profile);
  return preparedReceipt("doctor", initPlanFromManifest(manifest), "verified");
}

async function verifyInstalledSdk(profile: ProjectProfile): Promise<void> {
  try {
    const packageRoot = path.join(profile.root, "node_modules", SDK_PACKAGE);
    const packagePath = path.join(packageRoot, "package.json");
    await assertRegularFile(packagePath);
    const bytes = await readOptional(packagePath);
    if (!bytes) throw new Error("missing_sdk");
    const installed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (installed.name !== SDK_PACKAGE || installed.version !== SDK_VERSION) {
      throw new Error("wrong_sdk");
    }
    const exports = objectValue(installed.exports);
    const verification = objectValue(exports["./installation-verification"]);
    if (
      verification.types !== "./dist/installation-verification.d.ts" ||
      verification.import !== "./dist/installation-verification.js" ||
      verification.default !== "./dist/installation-verification.js"
    )
      throw new Error("invalid_sdk_contract");
    await assertRegularFile(
      path.join(packageRoot, "dist", "installation-verification.js"),
    );
    await assertRegularFile(
      path.join(packageRoot, "dist", "installation-verification.d.ts"),
    );
  } catch (error) {
    if (error instanceof CliBlockedError) throw error;
    throw new CliBlockedError("installed_sdk_invalid");
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_sdk_contract");
  return value as Record<string, unknown>;
}

async function assertRegularFile(target: string): Promise<void> {
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("invalid_sdk_contract");
}
