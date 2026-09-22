import {
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";

export interface BroadcastDraftCopyChanges {
  readonly title?: string | null;
  readonly subject?: string | null;
  readonly preheader?: string | null;
}

export interface BroadcastDraftRevisionInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly baseRevision: number;
  readonly operationId: string;
  readonly changes: BroadcastDraftCopyChanges;
}

export interface BroadcastDraftRevisionResult {
  readonly kind: "broadcast_draft_revision";
  readonly draft_id: string;
  readonly base_revision: number;
  readonly revision: number;
  readonly operation_id: string;
  readonly saved_at: string;
  readonly changes: BroadcastDraftCopyChanges;
}

interface BroadcastDraftPatchOptions {
  readonly method: "PATCH";
  readonly body: Record<string, unknown>;
  readonly lostResponseEffect: "unknown";
}

/**
 * This structural requester is satisfied by the hardened shared Core requester
 * once its PATCH support is composed. The shared requester remains owned by
 * the CLI integration lane.
 */
export type BroadcastDraftRequester = (
  path: string,
  options: BroadcastDraftPatchOptions,
) => Promise<unknown>;

export interface BroadcastDraftRevisionClient {
  reviseBroadcastDraft(
    input: BroadcastDraftRevisionInput,
  ): Promise<BroadcastDraftRevisionResult>;
}

export function createBroadcastDraftRevisionClient(
  request: BroadcastDraftRequester,
): BroadcastDraftRevisionClient {
  return {
    async reviseBroadcastDraft(input) {
      const value = await request(
        `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}?environment=production`,
        {
          method: "PATCH",
          lostResponseEffect: "unknown",
          body: {
            baseRevision: input.baseRevision,
            mutationKey: input.operationId,
            changes: input.changes,
          },
        },
      );
      const receipt = parseCoreReceipt(
        revisionReceipt,
        value,
        "unknown",
      );
      if (
        receipt.draftId !== input.draftId ||
        receipt.revision !== receipt.draftRevision ||
        !sameChanges(input.changes, receipt.draft)
      ) {
        throw new CoreOperatorError(
          "core_operator_receipt_invalid",
          null,
          "unknown",
        );
      }
      return {
        kind: "broadcast_draft_revision",
        draft_id: receipt.draftId,
        base_revision: input.baseRevision,
        revision: receipt.revision,
        operation_id: input.operationId,
        saved_at: receipt.savedAt,
        changes: input.changes,
      };
    },
  };
}

interface RevisionReceipt {
  readonly revision: number;
  readonly savedAt: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draft: Record<string, unknown>;
}

function revisionReceipt(value: unknown): RevisionReceipt {
  const root = record(value);
  const draft = record(root.draft);
  return {
    revision: positiveInteger(root.revision),
    savedAt: text(root.savedAt),
    draftId: text(draft.broadcastDraftId),
    draftRevision: positiveInteger(draft.version),
    draft,
  };
}

function sameChanges(
  changes: BroadcastDraftCopyChanges,
  draft: Record<string, unknown>,
): boolean {
  return (Object.keys(changes) as (keyof BroadcastDraftCopyChanges)[]).every(
    (key) => draft[key] === changes[key],
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("object required");
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("positive integer required");
  }
  return value as number;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("text required");
  }
  return value;
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
