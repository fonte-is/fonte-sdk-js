import {
  CoreOperatorError,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  createWorkspaceInvitationClient,
  type WorkspaceContextResult,
} from "./operator-workspace-invitation-client.js";
import {
  assertSegmentBodyBytes,
  assertSegmentRuleBytes,
  parseSegmentCommand,
  parseSegmentList,
  parseSegmentRead,
  validateSegmentFields,
  validateSegmentPageInput,
} from "./operator-segment-json.js";
import type {
  SegmentArchiveInput,
  SegmentCommandEnvelope,
  SegmentCommandReceiptInput,
  SegmentCreateInput,
  SegmentEnvironment,
  SegmentListEnvelope,
  SegmentListInput,
  SegmentReadEnvelope,
  SegmentReadInput,
  SegmentUpdateInput,
} from "./operator-segment-types.js";

const mutationTails = new Map<string, Promise<void>>();

export interface SegmentMetadataClient {
  list(input: SegmentListInput): Promise<SegmentListEnvelope>;
  read(input: SegmentReadInput): Promise<SegmentReadEnvelope>;
  create(input: SegmentCreateInput): Promise<SegmentCommandEnvelope>;
  update(input: SegmentUpdateInput): Promise<SegmentCommandEnvelope>;
  setArchived(input: SegmentArchiveInput): Promise<SegmentCommandEnvelope>;
  readCommand(
    input: SegmentCommandReceiptInput,
  ): Promise<SegmentCommandEnvelope>;
}

export type SegmentWorkspaceContexts = () => Promise<
  readonly WorkspaceContextResult[]
>;

export function createSegmentMetadataClient(
  request: CoreRequester,
  listWorkspaceContexts: SegmentWorkspaceContexts = () =>
    createWorkspaceInvitationClient(request).listWorkspaceContexts(),
  signal?: AbortSignal,
): SegmentMetadataClient {
  async function resolveScope(input: {
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
  }): Promise<{
    readonly workspaceId: string;
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
  }> {
    validScope(input.workspace, input.environment);
    const contexts = await listWorkspaceContexts();
    const matches = contexts.filter(
      (context) => context.workspace_slug === input.workspace,
    );
    if (matches.length > 1) invalid("workspace_context_ambiguous");
    const context = matches[0];
    if (!context) invalid("workspace_context_not_found");
    if (!context.available_environments.includes(input.environment)) {
      invalid("workspace_environment_unavailable");
    }
    return {
      workspaceId: context.workspace_id,
      workspace: input.workspace,
      environment: input.environment,
    };
  }

  async function readCommandInScope(
    scope: {
      readonly workspaceId: string;
      readonly workspace: string;
      readonly environment: SegmentEnvironment;
    },
    operationId: string,
    segmentId?: string,
  ): Promise<SegmentCommandEnvelope> {
    return parseSegmentCommand(
      await request(receiptPath(scope, operationId)),
      { tenantId: scope.workspaceId, environment: scope.environment },
      operationId,
      segmentId,
    );
  }

  async function recoverOneReceipt(
    originalError: unknown,
    scope: {
      readonly workspaceId: string;
      readonly workspace: string;
      readonly environment: SegmentEnvironment;
    },
    operationId: string,
    segmentId: string,
  ): Promise<SegmentCommandEnvelope | null> {
    if (!recoverableUnknown(originalError, signal)) return null;
    try {
      return await readCommandInScope(scope, operationId, segmentId);
    } catch {
      // Keep the original uncertain mutation result; a receipt read may race commit.
      return null;
    }
  }

  return {
    async list(input) {
      validateSegmentPageInput(input);
      const scope = await resolveScope(input);
      return parseSegmentList(await request(listPath(scope, input)), {
        tenantId: scope.workspaceId,
        environment: scope.environment,
      });
    },
    async read(input) {
      validateSegmentFields({ segmentId: input.segmentId }, "read");
      if (
        input.revision !== undefined &&
        (!Number.isSafeInteger(input.revision) || input.revision < 1)
      ) {
        invalid("core_request_invalid");
      }
      const scope = await resolveScope(input);
      return parseSegmentRead(
        await request(itemPath(scope, input.segmentId, input.revision)),
        { tenantId: scope.workspaceId, environment: scope.environment },
        input.segmentId,
        input.revision,
      );
    },
    async create(input) {
      validateSegmentFields(input, "create");
      assertSegmentRuleBytes(input.rule);
      return serializeMutation(
        `${input.workspace}/${input.environment}/${input.segmentId}`,
        async () => {
          const scope = await resolveScope(input);
          const body: Record<string, unknown> = {
            segmentId: input.segmentId,
            operationId: input.operationId,
            title: input.title,
            rule: input.rule,
          };
          assertSegmentBodyBytes(body);
          try {
            return parseSegmentCommand(
              await request(collectionPath(scope), {
                idempotencyKey: input.operationId,
                body,
                lostResponseEffect: "unknown",
                timeoutMs: 10_000,
              }),
              { tenantId: scope.workspaceId, environment: scope.environment },
              input.operationId,
              input.segmentId,
              "create",
            );
          } catch (error) {
            const recovered = await recoverOneReceipt(
              error,
              scope,
              input.operationId,
              input.segmentId,
            );
            if (recovered) return recovered;
            throw error;
          }
        },
      );
    },
    async update(input) {
      validateSegmentFields(input, "update");
      assertSegmentRuleBytes(input.rule);
      return serializeMutation(
        `${input.workspace}/${input.environment}/${input.segmentId}`,
        async () => {
          const scope = await resolveScope(input);
          const body: Record<string, unknown> = {
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            title: input.title,
            rule: input.rule,
          };
          assertSegmentBodyBytes(body);
          try {
            return parseSegmentCommand(
              await request(itemPath(scope, input.segmentId), {
                method: "PATCH",
                idempotencyKey: input.operationId,
                body,
                lostResponseEffect: "unknown",
                timeoutMs: 10_000,
              }),
              { tenantId: scope.workspaceId, environment: scope.environment },
              input.operationId,
              input.segmentId,
              "update",
            );
          } catch (error) {
            const recovered = await recoverOneReceipt(
              error,
              scope,
              input.operationId,
              input.segmentId,
            );
            if (recovered) return recovered;
            throw error;
          }
        },
      );
    },
    async setArchived(input) {
      validateSegmentFields(input, "archive");
      return serializeMutation(
        `${input.workspace}/${input.environment}/${input.segmentId}`,
        async () => {
          const scope = await resolveScope(input);
          const body: Record<string, unknown> = {
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            archived: input.archived,
          };
          assertSegmentBodyBytes(body);
          try {
            return parseSegmentCommand(
              await request(archivePath(scope, input.segmentId), {
                idempotencyKey: input.operationId,
                body,
                lostResponseEffect: "unknown",
                timeoutMs: 10_000,
              }),
              { tenantId: scope.workspaceId, environment: scope.environment },
              input.operationId,
              input.segmentId,
              "setArchived",
            );
          } catch (error) {
            const recovered = await recoverOneReceipt(
              error,
              scope,
              input.operationId,
              input.segmentId,
            );
            if (recovered) return recovered;
            throw error;
          }
        },
      );
    },
    async readCommand(input) {
      validUuid(input.operationId);
      const scope = await resolveScope(input);
      return readCommandInScope(scope, input.operationId);
    },
  };
}

function listPath(
  scope: {
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
  },
  input: SegmentListInput,
): string {
  const query = new URLSearchParams({ environment: scope.environment });
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.includeArchived !== undefined)
    query.set("includeArchived", String(input.includeArchived));
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/segments?${query.toString()}`;
}

function collectionPath(scope: {
  readonly workspace: string;
  readonly environment: SegmentEnvironment;
}): string {
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/segments?environment=${scope.environment}`;
}

function itemPath(
  scope: {
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
  },
  segmentId: string,
  revision?: number,
): string {
  const query = new URLSearchParams({ environment: scope.environment });
  if (revision !== undefined) query.set("revision", String(revision));
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/segments/${encodeURIComponent(segmentId)}?${query.toString()}`;
}

function archivePath(
  scope: {
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
  },
  segmentId: string,
): string {
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/segments/${encodeURIComponent(segmentId)}/archive?environment=${scope.environment}`;
}

function receiptPath(
  scope: {
    readonly workspace: string;
    readonly environment: SegmentEnvironment;
  },
  operationId: string,
): string {
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/segments/commands/${encodeURIComponent(operationId)}?environment=${scope.environment}`;
}

function validScope(workspace: string, environment: SegmentEnvironment): void {
  if (
    typeof workspace !== "string" ||
    workspace.length < 2 ||
    workspace.length > 63 ||
    workspace.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/u.test(workspace) ||
    (environment !== "sandbox" && environment !== "production")
  )
    invalid("core_request_invalid");
}

function validUuid(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  ) {
    invalid("core_request_invalid");
  }
}

function recoverableUnknown(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (
    signal?.aborted ||
    !(error instanceof CoreOperatorError) ||
    error.coreEffect !== "unknown"
  ) {
    return false;
  }
  return (
    error.reason !== "operation_cancelled" &&
    error.statusCode !== 401 &&
    !error.reason.startsWith("human_auth_") &&
    !error.reason.startsWith("client_auth_")
  );
}

function invalid(reason: string): never {
  throw new CoreOperatorError(reason, null, "none");
}

async function serializeMutation<Value>(
  key: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  mutationTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}
