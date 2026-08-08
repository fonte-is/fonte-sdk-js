export const FONTE_CONFIG_VERSION = "fonte.config.v2";
export const INSTALLATION_VERIFICATION_SCHEMA_VERSION =
  "fonte.installation_verification.v2";
export const INSTALLATION_VERIFICATION_SDK_VERSION = "0.1.0";

const installationAttemptIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface InstallationVerificationMetadata {
  schemaVersion: typeof INSTALLATION_VERIFICATION_SCHEMA_VERSION;
  installationAttemptId: string;
  sdkVersion: typeof INSTALLATION_VERIFICATION_SDK_VERSION;
  configVersion: typeof FONTE_CONFIG_VERSION;
}

const verificationKeys = new Set([
  "schemaVersion",
  "installationAttemptId",
  "sdkVersion",
  "configVersion",
]);

export function normalizeInstallationAttemptId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return installationAttemptIdPattern.test(value) ? value : "";
}

export function normalizeInstallationVerification(
  value: unknown,
): InstallationVerificationMetadata | null {
  if (!hasExactKeys(value, verificationKeys)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const installationAttemptId = normalizeInstallationAttemptId(
    input.installationAttemptId,
  );
  if (
    input.schemaVersion !== INSTALLATION_VERIFICATION_SCHEMA_VERSION ||
    input.sdkVersion !== INSTALLATION_VERIFICATION_SDK_VERSION ||
    input.configVersion !== FONTE_CONFIG_VERSION ||
    !installationAttemptId
  ) {
    return null;
  }

  return {
    schemaVersion: INSTALLATION_VERIFICATION_SCHEMA_VERSION,
    installationAttemptId,
    sdkVersion: INSTALLATION_VERIFICATION_SDK_VERSION,
    configVersion: FONTE_CONFIG_VERSION,
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
