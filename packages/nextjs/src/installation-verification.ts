import {
  normalizeInstallationVerification,
  type InstallationVerificationMetadata,
} from "@fonte-is/core/installation-verification";

export {
  FONTE_CONFIG_VERSION,
  INSTALLATION_VERIFICATION_SCHEMA_VERSION,
  INSTALLATION_VERIFICATION_SDK_VERSION,
  normalizeInstallationAttemptId,
  normalizeInstallationVerification,
  type InstallationVerificationMetadata,
} from "@fonte-is/core/installation-verification";

export const INSTALLATION_VERIFICATION_ADAPTER_ID = "next_app_router";
export const INSTALLATION_VERIFICATION_ADAPTER_VERSION = "v1";

export interface InstallationVerificationConfig extends InstallationVerificationMetadata {
  adapterId: typeof INSTALLATION_VERIFICATION_ADAPTER_ID;
  adapterVersion: typeof INSTALLATION_VERIFICATION_ADAPTER_VERSION;
}

const configKeys = new Set([
  "schemaVersion",
  "installationAttemptId",
  "sdkVersion",
  "configVersion",
  "adapterId",
  "adapterVersion",
]);

export function normalizeInstallationVerificationConfig(
  value: unknown,
): InstallationVerificationConfig | null {
  if (!hasExactKeys(value, configKeys)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const verification = normalizeInstallationVerification({
    schemaVersion: input.schemaVersion,
    installationAttemptId: input.installationAttemptId,
    sdkVersion: input.sdkVersion,
    configVersion: input.configVersion,
  });
  if (
    !verification ||
    input.adapterId !== INSTALLATION_VERIFICATION_ADAPTER_ID ||
    input.adapterVersion !== INSTALLATION_VERIFICATION_ADAPTER_VERSION
  ) {
    return null;
  }

  return {
    ...verification,
    adapterId: INSTALLATION_VERIFICATION_ADAPTER_ID,
    adapterVersion: INSTALLATION_VERIFICATION_ADAPTER_VERSION,
  };
}

function hasExactKeys(
  value: unknown,
  expectedKeys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key))
  );
}
