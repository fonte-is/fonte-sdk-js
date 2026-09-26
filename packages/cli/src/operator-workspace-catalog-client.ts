import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { record } from "./operator-broadcast-draft-snapshot.js";

export type WorkspaceEnvironment = "sandbox" | "production";
export type WorkspaceRole = "viewer" | "operator" | "admin" | "owner";

export interface WorkspaceSummary {
  readonly slug: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly available_environments: readonly WorkspaceEnvironment[];
}

export interface WorkspaceCatalogClient {
  listWorkspaces(): Promise<readonly WorkspaceSummary[]>;
}

export function createWorkspaceCatalogClient(
  request: CoreRequester,
): WorkspaceCatalogClient {
  return {
    async listWorkspaces() {
      return parseCoreReceipt(
        workspaceCatalogReceipt,
        await request("/v1/workspaces"),
      );
    },
  };
}

function workspaceCatalogReceipt(value: unknown): readonly WorkspaceSummary[] {
  const root = record(value);
  exactKeys(root, ["workspaces"]);
  if (!Array.isArray(root.workspaces) || root.workspaces.length > 500) {
    invalidReceipt();
  }
  const workspaces = root.workspaces.map(workspaceSummary);
  if (
    new Set(workspaces.map((workspace) => workspace.slug)).size !==
    workspaces.length
  ) {
    invalidReceipt();
  }
  return workspaces;
}

function workspaceSummary(value: unknown): WorkspaceSummary {
  const workspace = record(value);
  exactKeys(workspace, [
    "workspaceId",
    "tenantId",
    "accountId",
    "slug",
    "workspaceSlug",
    "workspaceCode",
    "displayName",
    "role",
    "availableEnvironments",
    ...(Object.hasOwn(workspace, "localBootstrapIdentity")
      ? ["localBootstrapIdentity"]
      : []),
  ]);
  const slug = text(workspace.slug, 63);
  if (
    slug !== text(workspace.workspaceSlug, 63) ||
    !/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(slug)
  ) {
    invalidReceipt();
  }
  const role = workspace.role;
  if (
    role !== "viewer" &&
    role !== "operator" &&
    role !== "admin" &&
    role !== "owner"
  ) {
    invalidReceipt();
  }
  if (
    !Array.isArray(workspace.availableEnvironments) ||
    workspace.availableEnvironments.length < 1 ||
    workspace.availableEnvironments.length > 2
  ) {
    invalidReceipt();
  }
  const environments = workspace.availableEnvironments.map(environment);
  if (new Set(environments).size !== environments.length) invalidReceipt();
  text(workspace.workspaceId, 200);
  text(workspace.tenantId, 200);
  text(workspace.accountId, 200);
  text(workspace.workspaceCode, 100);
  if (Object.hasOwn(workspace, "localBootstrapIdentity")) {
    const identity = workspace.localBootstrapIdentity;
    if (
      identity !== null &&
      (typeof identity !== "object" || Array.isArray(identity))
    ) {
      invalidReceipt();
    }
  }
  return {
    slug,
    name: text(workspace.displayName, 120),
    role,
    available_environments: environments,
  };
}

function environment(value: unknown): WorkspaceEnvironment {
  if (value === "sandbox" || value === "production") return value;
  return invalidReceipt();
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalidReceipt();
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== allowed.size ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalidReceipt();
  }
}

function invalidReceipt(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
}
