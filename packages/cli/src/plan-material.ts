import {
  ADAPTER_ID,
  ADAPTER_VERSION,
  IGNORE_BLOCK_TEXT,
  IGNORE_PATH,
  LOCAL_MANIFEST_PATH,
  MANAGED_SOURCE_PATH,
  MANAGED_SOURCE_TEXT,
  PLAN_SCHEMA_VERSION,
  SDK_PACKAGE,
  SDK_VERSION,
} from "./constants.js";
import { sha256 } from "./digests.js";
import type { InstallationPlanMaterial, PlanOperation } from "./types.js";

const baseMaterial: Omit<InstallationPlanMaterial, "command" | "operations"> = {
  schema_version: PLAN_SCHEMA_VERSION,
  adapter_id: ADAPTER_ID,
  adapter_version: ADAPTER_VERSION,
  package_manager: "npm",
  sdk_package: SDK_PACKAGE,
  sdk_version: SDK_VERSION,
};

export function createInitMaterial(
  addDependency: boolean,
  addIgnore: boolean,
): InstallationPlanMaterial {
  return {
    ...baseMaterial,
    command: "init",
    operations: [
      {
        id: "sdk_dependency",
        kind: "dependency",
        path: "package.json",
        action: addDependency ? "add" : "none",
      },
      {
        id: "installation_module",
        kind: "create_file",
        path: MANAGED_SOURCE_PATH,
        action: "create",
        sha256: sha256(MANAGED_SOURCE_TEXT),
      },
      {
        id: "local_state_ignore",
        kind: "managed_block",
        path: IGNORE_PATH,
        action: addIgnore ? "add" : "none",
        ...(addIgnore ? { sha256: sha256(IGNORE_BLOCK_TEXT) } : {}),
      },
      {
        id: "local_manifest",
        kind: "create_local_manifest",
        path: LOCAL_MANIFEST_PATH,
        action: "create",
      },
    ],
  };
}

export function createRemoveMaterial(
  operations: PlanOperation[],
): InstallationPlanMaterial {
  return { ...baseMaterial, command: "remove", operations };
}
