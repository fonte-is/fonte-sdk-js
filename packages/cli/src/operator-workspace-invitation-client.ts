import {
  type CoreRequester,
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";

export type WorkspaceInvitationEnvironment = "sandbox" | "production";
export type WorkspaceInvitationRole = "viewer" | "operator" | "admin" | "owner";
export type WorkspaceInvitationStatus =
  "pending" | "claimed" | "revoked" | "expired";

export interface WorkspaceInvitationWorkspaceResult {
  readonly workspace_id: string;
  readonly workspace_slug: string;
  readonly workspace_code: string;
  readonly display_name: string;
  readonly environment: WorkspaceInvitationEnvironment;
}

export interface WorkspaceInvitationResult {
  readonly invitation_id: string;
  readonly workspace: WorkspaceInvitationWorkspaceResult;
  readonly intended_identity: {
    readonly supabase_subject: string;
    readonly email: string;
  };
  readonly role: WorkspaceInvitationRole;
  readonly status: WorkspaceInvitationStatus;
  readonly issued_by_supabase_subject: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly claimed_at: string | null;
}

export interface WorkspaceInvitationCreateInput {
  readonly workspace: string;
  readonly environment: WorkspaceInvitationEnvironment;
  readonly intendedSupabaseSubject: string;
  readonly intendedEmail: string;
  readonly role: WorkspaceInvitationRole;
  readonly expiresAt: string;
}

export interface WorkspaceInvitationCreateResult {
  readonly schema_version: "workspace-invitation.v0";
  readonly invitation: WorkspaceInvitationResult;
  readonly invitation_token: string;
}

export interface WorkspaceInvitationClaimInput {
  readonly workspace: string;
  readonly environment: WorkspaceInvitationEnvironment;
  readonly invitationToken: string;
}

export interface WorkspaceInvitationClaimResult {
  readonly schema_version: "workspace-invitation.v0";
  readonly invitation_id: string;
  readonly workspace: WorkspaceInvitationWorkspaceResult;
  readonly role: WorkspaceInvitationRole;
  readonly status: "claimed";
  readonly grant_id: string;
  readonly grant_created: boolean;
  readonly replayed: boolean;
  readonly claimed_at: string;
}

export interface WorkspaceContextResult {
  readonly workspace_id: string;
  readonly account_id: string;
  readonly workspace_slug: string;
  readonly workspace_code: string;
  readonly display_name: string;
  readonly role: WorkspaceInvitationRole;
  readonly available_environments: readonly WorkspaceInvitationEnvironment[];
}

export interface WorkspaceInvitationClient {
  createWorkspaceInvitation(
    input: WorkspaceInvitationCreateInput,
  ): Promise<WorkspaceInvitationCreateResult>;
  claimWorkspaceInvitation(
    input: WorkspaceInvitationClaimInput,
  ): Promise<WorkspaceInvitationClaimResult>;
  listWorkspaceContexts(): Promise<readonly WorkspaceContextResult[]>;
}

export function createWorkspaceInvitationClient(
  request: CoreRequester,
): WorkspaceInvitationClient {
  return {
    async createWorkspaceInvitation(input) {
      const workspace = workspaceSlug(input.workspace);
      const environment = workspaceEnvironment(input.environment);
      const intendedSupabaseSubject = boundedText(
        input.intendedSupabaseSubject,
        200,
      );
      const intendedEmail = emailAddress(input.intendedEmail);
      const role = workspaceRole(input.role);
      const expiresAt = instant(input.expiresAt);
      const result = await request(
        `/v1/workspaces/${encodeURIComponent(workspace)}/invitations?environment=${environment}`,
        {
          body: {
            intendedSupabaseSubject,
            intendedEmail,
            role,
            expiresAt,
          },
          lostResponseEffect: "unknown",
        },
      );
      return parseCoreReceipt(
        (value) => {
          const parsed = parseInvitationCreate(value);
          if (
            parsed.invitation.workspace.workspace_slug !== workspace ||
            parsed.invitation.workspace.environment !== environment ||
            parsed.invitation.intended_identity.supabase_subject !==
              intendedSupabaseSubject ||
            parsed.invitation.intended_identity.email !== intendedEmail ||
            parsed.invitation.role !== role ||
            parsed.invitation.expires_at !== expiresAt
          ) {
            invalidReceipt();
          }
          return parsed;
        },
        result,
        "unknown",
      );
    },
    async claimWorkspaceInvitation(input) {
      const workspace = workspaceSlug(input.workspace);
      const environment = workspaceEnvironment(input.environment);
      const result = await request("/v1/workspace-invitations/claim", {
        body: {
          invitationToken: invitationToken(input.invitationToken),
          workspaceSlug: workspace,
          environment,
        },
        lostResponseEffect: "unknown",
      });
      return parseCoreReceipt(
        (value) => {
          const parsed = parseInvitationClaim(value);
          if (
            parsed.workspace.workspace_slug !== workspace ||
            parsed.workspace.environment !== environment
          )
            invalidReceipt();
          return parsed;
        },
        result,
        "unknown",
      );
    },
    async listWorkspaceContexts() {
      return parseCoreReceipt(
        parseWorkspaceContexts,
        await request("/v1/workspaces"),
      );
    },
  };
}

function parseInvitationCreate(
  value: unknown,
): WorkspaceInvitationCreateResult {
  const body = exactObject(value, [
    "schemaVersion",
    "invitation",
    "invitationToken",
  ]);
  if (body.schemaVersion !== "workspace-invitation.v0") invalidReceipt();
  const invitation = parseInvitation(body.invitation);
  if (
    invitation.status !== "pending" ||
    invitation.revoked_at !== null ||
    invitation.claimed_at !== null
  )
    invalidReceipt();
  return {
    schema_version: "workspace-invitation.v0",
    invitation,
    invitation_token: invitationToken(body.invitationToken),
  };
}

function parseInvitationClaim(value: unknown): WorkspaceInvitationClaimResult {
  const body = exactObject(value, [
    "schemaVersion",
    "invitationId",
    "workspace",
    "role",
    "status",
    "grantId",
    "grantCreated",
    "replayed",
    "claimedAt",
  ]);
  if (
    body.schemaVersion !== "workspace-invitation.v0" ||
    body.status !== "claimed"
  ) {
    invalidReceipt();
  }
  return {
    schema_version: "workspace-invitation.v0",
    invitation_id: boundedText(body.invitationId, 500),
    workspace: parseInvitationWorkspace(body.workspace),
    role: workspaceRole(body.role),
    status: "claimed",
    grant_id: boundedText(body.grantId, 500),
    grant_created: boolean(body.grantCreated),
    replayed: boolean(body.replayed),
    claimed_at: instant(body.claimedAt),
  };
}

function parseInvitation(value: unknown): WorkspaceInvitationResult {
  const body = exactObject(value, [
    "invitationId",
    "workspace",
    "intendedIdentity",
    "role",
    "status",
    "issuedBySupabaseSubject",
    "createdAt",
    "expiresAt",
    "revokedAt",
    "claimedAt",
  ]);
  const identity = exactObject(body.intendedIdentity, [
    "supabaseSubject",
    "email",
  ]);
  return {
    invitation_id: boundedText(body.invitationId, 500),
    workspace: parseInvitationWorkspace(body.workspace),
    intended_identity: {
      supabase_subject: boundedText(identity.supabaseSubject, 200),
      email: canonicalEmailAddress(identity.email),
    },
    role: workspaceRole(body.role),
    status: invitationStatus(body.status),
    issued_by_supabase_subject: boundedText(body.issuedBySupabaseSubject, 500),
    created_at: instant(body.createdAt),
    expires_at: instant(body.expiresAt),
    revoked_at: optionalInstant(body.revokedAt),
    claimed_at: optionalInstant(body.claimedAt),
  };
}

function parseInvitationWorkspace(
  value: unknown,
): WorkspaceInvitationWorkspaceResult {
  const body = exactObject(value, [
    "workspaceId",
    "workspaceSlug",
    "workspaceCode",
    "displayName",
    "environment",
  ]);
  return {
    workspace_id: boundedText(body.workspaceId, 500),
    workspace_slug: workspaceSlug(body.workspaceSlug),
    workspace_code: boundedText(body.workspaceCode, 200),
    display_name: boundedText(body.displayName, 200),
    environment: workspaceEnvironment(body.environment),
  };
}

function parseWorkspaceContexts(
  value: unknown,
): readonly WorkspaceContextResult[] {
  const body = exactObject(value, ["workspaces"]);
  if (!Array.isArray(body.workspaces)) invalidReceipt();
  const contexts = body.workspaces.map((value) => {
    const item = object(value);
    const keys = [
      "workspaceId",
      "tenantId",
      "accountId",
      "slug",
      "workspaceSlug",
      "workspaceCode",
      "displayName",
      "role",
      "availableEnvironments",
    ];
    const actual = Object.keys(item);
    if (actual.includes("localBootstrapIdentity"))
      keys.push("localBootstrapIdentity");
    if (
      !sameKeys(actual, keys) ||
      item.tenantId !== item.workspaceId ||
      item.slug !== item.workspaceSlug ||
      !Array.isArray(item.availableEnvironments) ||
      new Set(item.availableEnvironments).size !==
        item.availableEnvironments.length ||
      ("localBootstrapIdentity" in item &&
        typeof item.localBootstrapIdentity !== "string")
    ) {
      invalidReceipt();
    }
    return {
      workspace_id: boundedText(item.workspaceId, 500),
      account_id: boundedText(item.accountId, 500),
      workspace_slug: workspaceSlug(item.workspaceSlug),
      workspace_code: boundedText(item.workspaceCode, 200),
      display_name: boundedText(item.displayName, 200),
      role: workspaceRole(item.role),
      available_environments:
        item.availableEnvironments.map(workspaceEnvironment),
    };
  });
  if (
    new Set(contexts.map((item) => item.workspace_id)).size !==
      contexts.length ||
    new Set(contexts.map((item) => item.workspace_slug)).size !==
      contexts.length
  ) {
    invalidReceipt();
  }
  return contexts;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const body = object(value);
  if (!sameKeys(Object.keys(body), keys)) invalidReceipt();
  return body;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalidReceipt();
  return value as Record<string, unknown>;
}

function sameKeys(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return [...actual].sort().join("\0") === [...expected].sort().join("\0");
}

function workspaceSlug(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  ) {
    invalidRequest();
  }
  return value;
}

function workspaceEnvironment(value: unknown): WorkspaceInvitationEnvironment {
  if (value !== "sandbox" && value !== "production") invalidRequest();
  return value;
}

function workspaceRole(value: unknown): WorkspaceInvitationRole {
  if (
    value !== "viewer" &&
    value !== "operator" &&
    value !== "admin" &&
    value !== "owner"
  ) {
    invalidRequest();
  }
  return value;
}

function invitationStatus(value: unknown): WorkspaceInvitationStatus {
  if (
    value !== "pending" &&
    value !== "claimed" &&
    value !== "revoked" &&
    value !== "expired"
  )
    invalidReceipt();
  return value;
}

function invitationToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    invalidRequest();
  return value;
}

function emailAddress(value: unknown): string {
  if (typeof value !== "string") invalidRequest();
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    /\s/.test(normalized)
  ) {
    invalidRequest();
  }
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes(".")) {
    invalidRequest();
  }
  return normalized;
}

function canonicalEmailAddress(value: unknown): string {
  const normalized = emailAddress(value);
  if (value !== normalized) invalidReceipt();
  return normalized;
}

function boundedText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  )
    invalidRequest();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string") invalidRequest();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    invalidRequest();
  return value;
}

function optionalInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalidReceipt();
  return value;
}

function invalidRequest(): never {
  throw new CoreOperatorError(
    "workspace_invitation_request_invalid",
    null,
    "none",
  );
}

function invalidReceipt(): never {
  throw new TypeError("workspace invitation receipt is invalid");
}
