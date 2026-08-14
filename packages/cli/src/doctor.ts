import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  await verifyInstalledSdk(profile, manifest);
  return preparedReceipt("doctor", initPlanFromManifest(manifest), "verified");
}

async function verifyInstalledSdk(
  profile: ProjectProfile,
  manifest: LocalManifest,
): Promise<void> {
  try {
    const packagePath = path.join(
      profile.root,
      "node_modules",
      SDK_PACKAGE,
      "package.json",
    );
    const bytes = await readOptional(packagePath);
    if (!bytes) throw new Error("missing_sdk");
    const installed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (installed.name !== SDK_PACKAGE || installed.version !== SDK_VERSION) {
      throw new Error("wrong_sdk");
    }
    const require = createRequire(path.join(profile.root, "package.json"));
    const modulePath =
      require.resolve("@fonte-is/nextjs/installation-verification");
    const sdk = (await import(pathToFileURL(modulePath).href)) as Record<
      string,
      unknown
    >;
    if (
      sdk.FONTE_CONFIG_VERSION !== "fonte.config.v2" ||
      sdk.INSTALLATION_VERIFICATION_SCHEMA_VERSION !==
        "fonte.installation_verification.v2" ||
      sdk.INSTALLATION_VERIFICATION_SDK_VERSION !== SDK_VERSION ||
      sdk.INSTALLATION_VERIFICATION_ADAPTER_ID !== "next_app_router" ||
      sdk.INSTALLATION_VERIFICATION_ADAPTER_VERSION !== "v1" ||
      typeof sdk.normalizeInstallationVerificationConfig !== "function"
    ) {
      throw new Error("invalid_sdk_contract");
    }
    const normalize = sdk.normalizeInstallationVerificationConfig as (
      value: unknown,
    ) => unknown;
    const normalized = normalize({
      schemaVersion: sdk.INSTALLATION_VERIFICATION_SCHEMA_VERSION,
      installationAttemptId: manifest.installation_id,
      sdkVersion: sdk.INSTALLATION_VERIFICATION_SDK_VERSION,
      configVersion: sdk.FONTE_CONFIG_VERSION,
      adapterId: sdk.INSTALLATION_VERIFICATION_ADAPTER_ID,
      adapterVersion: sdk.INSTALLATION_VERIFICATION_ADAPTER_VERSION,
    });
    if (!normalized) throw new Error("invalid_installation_metadata");
  } catch (error) {
    if (error instanceof CliBlockedError) throw error;
    throw new CliBlockedError("installed_sdk_invalid");
  }
}
