import {
  CoreOperatorError,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  createWorkspaceInvitationClient,
  type WorkspaceContextResult,
} from "./operator-workspace-invitation-client.js";
import {
  assertCampaignBodyBytes,
  parseCampaignCommand,
  parseCampaignList,
  parseCampaignRead,
  validateCampaignFields,
  validateCampaignPageInput,
} from "./operator-campaign-json.js";
import type {
  CampaignCommandEnvelope,
  CampaignCommandReceiptInput,
  CampaignCreateInput,
  CampaignEnvironment,
  CampaignListEnvelope,
  CampaignListInput,
  CampaignReadEnvelope,
  CampaignReadInput,
  CampaignUpdateInput,
} from "./operator-campaign-types.js";

const mutationTails = new Map<string, Promise<void>>();

export const CAMPAIGN_SEGMENT_RESPONSE_MAX_BYTES = 1_048_576;
export const CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS = 10_000;

export interface CampaignMetadataClient {
  list(input: CampaignListInput): Promise<CampaignListEnvelope>;
  read(input: CampaignReadInput): Promise<CampaignReadEnvelope>;
  create(input: CampaignCreateInput): Promise<CampaignCommandEnvelope>;
  update(input: CampaignUpdateInput): Promise<CampaignCommandEnvelope>;
  readCommand(
    input: CampaignCommandReceiptInput,
  ): Promise<CampaignCommandEnvelope>;
}

export type CampaignWorkspaceContexts = () => Promise<
  readonly WorkspaceContextResult[]
>;

export function createCampaignMetadataClient(
  request: CoreRequester,
  listWorkspaceContexts: CampaignWorkspaceContexts = () =>
    createWorkspaceInvitationClient(request).listWorkspaceContexts({
      timeoutMs: CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS,
    }),
  signal?: AbortSignal,
): CampaignMetadataClient {
  async function resolveScope(input: {
    readonly workspace: string;
    readonly environment: CampaignEnvironment;
  }): Promise<{
    readonly workspaceId: string;
    readonly workspace: string;
    readonly environment: CampaignEnvironment;
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
      readonly environment: CampaignEnvironment;
    },
    operationId: string,
    campaignId?: string,
  ): Promise<CampaignCommandEnvelope> {
    return parseCampaignCommand(
      await request(receiptPath(scope, operationId), {
        timeoutMs: CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS,
      }),
      { tenantId: scope.workspaceId, environment: scope.environment },
      operationId,
      campaignId,
    );
  }

  async function recoverOneReceipt(
    originalError: unknown,
    scope: {
      readonly workspaceId: string;
      readonly workspace: string;
      readonly environment: CampaignEnvironment;
    },
    operationId: string,
    campaignId: string,
  ): Promise<CampaignCommandEnvelope | null> {
    if (!recoverableUnknown(originalError, signal)) return null;
    try {
      return await readCommandInScope(scope, operationId, campaignId);
    } catch {
      // Keep the original uncertain mutation result; a receipt read may race commit.
      return null;
    }
  }

  return {
    async list(input) {
      validateCampaignPageInput(input);
      const scope = await resolveScope(input);
      return parseCampaignList(
        await request(listPath(scope, input), {
          timeoutMs: CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS,
        }),
        {
          tenantId: scope.workspaceId,
          environment: scope.environment,
        },
      );
    },
    async read(input) {
      validateCampaignFields({ campaignId: input.campaignId }, "read");
      const scope = await resolveScope(input);
      return parseCampaignRead(
        await request(itemPath(scope, input.campaignId), {
          timeoutMs: CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS,
        }),
        { tenantId: scope.workspaceId, environment: scope.environment },
        input.campaignId,
      );
    },
    async create(input) {
      validateCampaignFields(input, "create");
      return serializeMutation(
        `${input.workspace}/${input.environment}/${input.campaignId}`,
        async () => {
          const scope = await resolveScope(input);
          const body: Record<string, unknown> = {
            campaignId: input.campaignId,
            operationId: input.operationId,
            title: input.title,
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
          };
          assertCampaignBodyBytes(body);
          try {
            return parseCampaignCommand(
              await request(collectionPath(scope), {
                idempotencyKey: input.operationId,
                body,
                lostResponseEffect: "unknown",
                timeoutMs: CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS,
              }),
              { tenantId: scope.workspaceId, environment: scope.environment },
              input.operationId,
              input.campaignId,
              "create",
            );
          } catch (error) {
            const recovered = await recoverOneReceipt(
              error,
              scope,
              input.operationId,
              input.campaignId,
            );
            if (recovered) return recovered;
            throw error;
          }
        },
      );
    },
    async update(input) {
      validateCampaignFields(input, "update");
      return serializeMutation(
        `${input.workspace}/${input.environment}/${input.campaignId}`,
        async () => {
          const scope = await resolveScope(input);
          const body: Record<string, unknown> = {
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
            title: input.title,
            description: input.description,
            archived: input.archived,
          };
          assertCampaignBodyBytes(body);
          try {
            return parseCampaignCommand(
              await request(itemPath(scope, input.campaignId), {
                method: "PATCH",
                idempotencyKey: input.operationId,
                body,
                lostResponseEffect: "unknown",
                timeoutMs: CAMPAIGN_SEGMENT_REQUEST_TIMEOUT_MS,
              }),
              { tenantId: scope.workspaceId, environment: scope.environment },
              input.operationId,
              input.campaignId,
              "update",
            );
          } catch (error) {
            const recovered = await recoverOneReceipt(
              error,
              scope,
              input.operationId,
              input.campaignId,
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
    readonly environment: CampaignEnvironment;
  },
  input: CampaignListInput,
): string {
  const query = new URLSearchParams({ environment: scope.environment });
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.includeArchived !== undefined)
    query.set("includeArchived", String(input.includeArchived));
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/campaign-configurations?${query.toString()}`;
}

function collectionPath(scope: {
  readonly workspace: string;
  readonly environment: CampaignEnvironment;
}): string {
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/campaign-configurations?environment=${scope.environment}`;
}

function itemPath(
  scope: {
    readonly workspace: string;
    readonly environment: CampaignEnvironment;
  },
  campaignId: string,
): string {
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/campaign-configurations/${encodeURIComponent(campaignId)}?environment=${scope.environment}`;
}

function receiptPath(
  scope: {
    readonly workspace: string;
    readonly environment: CampaignEnvironment;
  },
  operationId: string,
): string {
  return `/v1/workspaces/${encodeURIComponent(scope.workspace)}/campaign-configurations/commands/${encodeURIComponent(operationId)}?environment=${scope.environment}`;
}

function validScope(workspace: string, environment: CampaignEnvironment): void {
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
