import {
  ADAPTER_ID,
  ADAPTER_VERSION,
  CLI_VERSION,
  IGNORE_BLOCK_TEXT,
  IGNORE_PATH,
  MANAGED_SOURCE_PATH,
  MANAGED_SOURCE_TEXT,
  MANIFEST_SCHEMA_VERSION,
  SDK_PACKAGE,
  SDK_VERSION,
} from "./constants.js";
import { sha256 } from "./digests.js";
import { CliBlockedError } from "./errors.js";
import { readOptional } from "./filesystem.js";
import { assertManagedPathSafe } from "./paths.js";
import type {
  InstallationPlan,
  LocalManifest,
  ManagedOperation,
} from "./types.js";

export function manifestForPlan(
  plan: InstallationPlan,
  installationId: string,
): LocalManifest {
  const managed: ManagedOperation[] = [];
  if (operationActs(plan, "sdk_dependency", "add")) {
    managed.push({
      id: "sdk_dependency",
      kind: "dependency",
      path: "package.json",
      package: SDK_PACKAGE,
      version: SDK_VERSION,
      previous: "absent",
    });
  }
  managed.push({
    id: "installation_module",
    kind: "created_file",
    path: MANAGED_SOURCE_PATH,
    sha256: sha256(MANAGED_SOURCE_TEXT),
  });
  if (operationActs(plan, "local_state_ignore", "add")) {
    managed.push({
      id: "local_state_ignore",
      kind: "managed_block",
      path: IGNORE_PATH,
      sha256: sha256(IGNORE_BLOCK_TEXT),
    });
  }
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    installation_id: installationId,
    cli_version: CLI_VERSION,
    adapter_id: ADAPTER_ID,
    adapter_version: ADAPTER_VERSION,
    sdk_package: SDK_PACKAGE,
    sdk_version: SDK_VERSION,
    plan_sha256: plan.plan_sha256,
    managed_operations: managed,
  };
}

export function operationActs(
  plan: InstallationPlan,
  id: string,
  action: "add" | "remove",
): boolean {
  return plan.operations.some(
    (operation) => operation.id === id && operation.action === action,
  );
}

export async function assertSourceStillExact(
  root: string,
  manifest: LocalManifest,
): Promise<void> {
  const owned = manifest.managed_operations.find(
    ({ id }) => id === "installation_module",
  );
  const bytes = await readOptional(
    await assertManagedPathSafe(root, MANAGED_SOURCE_PATH),
  );
  if (
    !owned ||
    owned.kind !== "created_file" ||
    !bytes ||
    sha256(bytes) !== owned.sha256
  ) {
    throw new CliBlockedError("managed_code_drifted");
  }
}
