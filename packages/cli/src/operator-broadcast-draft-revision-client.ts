import {
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";
import {
  broadcastDraftSnapshot,
  positiveInteger,
  record,
  type BroadcastDraftSnapshot,
} from "./operator-broadcast-draft-snapshot.js";

export interface BroadcastDraftRevisionChanges {
  readonly title?: string | null;
  readonly sender?: string | null;
  readonly replyTo?: string | null;
  readonly subject?: string | null;
  readonly preheader?: string | null;
  readonly textBody?: string | null;
  readonly activeSource?: "composer" | "html";
  readonly composerBody?: string | null;
  readonly htmlBody?: string | null;
}

export interface BroadcastDraftRevisionInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly baseRevision: number;
  readonly operationId: string;
  readonly changes: BroadcastDraftRevisionChanges;
}

export interface BroadcastDraftRevisionResult {
  readonly kind: "broadcast_draft_revision";
  readonly draft_id: string;
  readonly base_revision: number;
  readonly revision: number;
  readonly operation_id: string;
  readonly saved_at: string;
  readonly draft: BroadcastDraftSnapshot;
}

interface BroadcastDraftPatchOptions {
  readonly method: "PATCH";
  readonly body: Record<string, unknown>;
  readonly lostResponseEffect: "unknown";
}

/** Satisfied by the shared requester after the integration owner composes PATCH support. */
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
      const receipt = parseCoreReceipt(revisionReceipt, value, "unknown");
      if (
        receipt.draft.draft_id !== input.draftId ||
        receipt.revision !== receipt.draft.revision ||
        receipt.savedAt !== receipt.draft.updated_at ||
        !sameChanges(input.changes, receipt.rawDraft)
      ) {
        invalidReceipt();
      }
      return {
        kind: "broadcast_draft_revision",
        draft_id: receipt.draft.draft_id,
        base_revision: input.baseRevision,
        revision: receipt.revision,
        operation_id: input.operationId,
        saved_at: receipt.savedAt,
        draft: receipt.draft,
      };
    },
  };
}

interface RevisionReceipt {
  readonly revision: number;
  readonly savedAt: string;
  readonly draft: BroadcastDraftSnapshot;
  readonly rawDraft: Record<string, unknown>;
}

function revisionReceipt(value: unknown): RevisionReceipt {
  const root = record(value);
  const rawDraft = record(root.draft);
  const draft = broadcastDraftSnapshot(rawDraft);
  return {
    revision: positiveInteger(root.revision),
    savedAt: text(root.savedAt),
    draft,
    rawDraft,
  };
}

function sameChanges(
  changes: BroadcastDraftRevisionChanges,
  draft: Record<string, unknown>,
): boolean {
  return (Object.keys(changes) as (keyof BroadcastDraftRevisionChanges)[])
    .every((key) => draft[key] === changes[key]);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("text required");
  }
  return value;
}

function invalidReceipt(): never {
  throw new CoreOperatorError(
    "core_operator_receipt_invalid",
    null,
    "unknown",
  );
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
