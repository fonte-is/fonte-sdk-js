import type { LocalManifest, ManagedOperation } from "./types.js";
import { CLI_VERSION, LOCAL_MANIFEST_PATH } from "./constants.js";
import { CliBlockedError } from "./errors.js";
import { readOptional } from "./filesystem.js";
import { assertManagedPathSafe } from "./paths.js";

const manifestKeys = new Set([
  "schema_version",
  "installation_id",
  "cli_version",
  "adapter_id",
  "adapter_version",
  "sdk_package",
  "sdk_version",
  "plan_sha256",
  "managed_operations",
]);

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = /^[0-9a-f]{64}$/;
const compatibleCliVersions = new Set<LocalManifest["cli_version"]>([
  "0.1.0",
  "0.1.1",
  "0.1.2",
  "0.1.3",
  "0.1.4",
  CLI_VERSION,
]);

function hasExactKeys(
  value: unknown,
  keys: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function parseManagedOperation(value: unknown): ManagedOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.id === "sdk_dependency") {
    const keys = new Set([
      "id",
      "kind",
      "path",
      "package",
      "version",
      "previous",
    ]);
    return hasExactKeys(input, keys) &&
      input.kind === "dependency" &&
      input.path === "package.json" &&
      input.package === "@fonte-is/nextjs" &&
      input.version === "0.1.0" &&
      input.previous === "absent"
      ? (input as unknown as ManagedOperation)
      : null;
  }
  const keys = new Set(["id", "kind", "path", "sha256"]);
  if (!hasExactKeys(input, keys) || !sha256.test(String(input.sha256))) {
    return null;
  }
  if (
    input.id === "installation_module" &&
    input.kind === "created_file" &&
    input.path === "fonte/installation.ts"
  ) {
    return input as unknown as ManagedOperation;
  }
  if (
    input.id === "local_state_ignore" &&
    input.kind === "managed_block" &&
    input.path === ".gitignore"
  ) {
    return input as unknown as ManagedOperation;
  }
  return null;
}

export function parseManifest(value: unknown): LocalManifest | null {
  if (!hasExactKeys(value, manifestKeys)) return null;
  if (
    value.schema_version !== "fonte.local_installation.v1" ||
    !uuidV4.test(String(value.installation_id)) ||
    !compatibleCliVersions.has(
      value.cli_version as LocalManifest["cli_version"],
    ) ||
    value.adapter_id !== "next_app_router" ||
    value.adapter_version !== "v1" ||
    value.sdk_package !== "@fonte-is/nextjs" ||
    value.sdk_version !== "0.1.0" ||
    !sha256.test(String(value.plan_sha256)) ||
    !Array.isArray(value.managed_operations)
  ) {
    return null;
  }
  const operations = value.managed_operations.map(parseManagedOperation);
  if (operations.some((operation) => operation === null)) return null;
  const ids = operations.map((operation) => operation!.id);
  if (new Set(ids).size !== ids.length) return null;
  const order = ids.join(",");
  if (
    !new Set([
      "installation_module",
      "installation_module,local_state_ignore",
      "sdk_dependency,installation_module",
      "sdk_dependency,installation_module,local_state_ignore",
    ]).has(order)
  ) {
    return null;
  }
  return {
    schema_version: "fonte.local_installation.v1",
    installation_id: String(value.installation_id),
    cli_version: value.cli_version as LocalManifest["cli_version"],
    adapter_id: "next_app_router",
    adapter_version: "v1",
    sdk_package: "@fonte-is/nextjs",
    sdk_version: "0.1.0",
    plan_sha256: String(value.plan_sha256),
    managed_operations: operations as ManagedOperation[],
  };
}

/** Read and validate the fixed local manifest path. */
export async function readManifest(root: string): Promise<LocalManifest> {
  const target = await assertManagedPathSafe(root, LOCAL_MANIFEST_PATH);
  const bytes = await readOptional(target);
  if (!bytes) throw new CliBlockedError("installation_not_found");
  const parsed = (() => {
    try {
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    } catch {
      return null;
    }
  })();
  const manifest = parseManifest(parsed);
  if (!manifest) throw new CliBlockedError("installation_manifest_invalid");
  return manifest;
}

/** Serialize with two-space indentation, fixed key order, and final newline. */
export function serializeManifest(manifest: LocalManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
