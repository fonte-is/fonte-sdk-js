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
import {
  parseBroadcastRecipientSelection,
  sameBroadcastRecipientSelection,
  type BroadcastRecipientSelection,
} from "./operator-broadcast-targeting-selection.js";

export interface BroadcastTargetingInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly baseRevision: number;
  readonly operationId: string;
  readonly recipientSelection: BroadcastRecipientSelection;
}

export interface BroadcastTargetingResult {
  readonly kind: "broadcast_targeting_revision";
  readonly draft_id: string;
  readonly base_revision: number;
  readonly revision: number;
  readonly operation_id: string;
  readonly saved_at: string;
  readonly recipient_selection: BroadcastRecipientSelection;
  readonly draft: BroadcastDraftSnapshot;
}

export interface BroadcastTargetingClient {
  updateBroadcastTargeting(
    input: BroadcastTargetingInput,
  ): Promise<BroadcastTargetingResult>;
}

export function createBroadcastTargetingClient(
  request: (
    path: string,
    options: {
      readonly method: "PATCH";
      readonly body: Record<string, unknown>;
      readonly lostResponseEffect: "unknown";
    },
  ) => Promise<unknown>,
): BroadcastTargetingClient {
  return {
    async updateBroadcastTargeting(input) {
      const selection = parseBroadcastRecipientSelection(
        input.recipientSelection,
      );
      const receipt = parseCoreReceipt(
        targetingReceipt,
        await request(
          `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}?environment=production`,
          {
            method: "PATCH",
            lostResponseEffect: "unknown",
            body: {
              baseRevision: input.baseRevision,
              mutationKey: input.operationId,
              changes: { recipientSelection: selection },
            },
          },
        ),
        "unknown",
      );
      if (
        receipt.draft.draft_id !== input.draftId ||
        receipt.revision !== receipt.draft.revision ||
        receipt.savedAt !== receipt.draft.updated_at ||
        !sameBroadcastRecipientSelection(receipt.selection, selection)
      )
        invalidReceipt();
      return {
        kind: "broadcast_targeting_revision",
        draft_id: receipt.draft.draft_id,
        base_revision: input.baseRevision,
        revision: receipt.revision,
        operation_id: input.operationId,
        saved_at: receipt.savedAt,
        recipient_selection: receipt.selection,
        draft: receipt.draft,
      };
    },
  };
}

interface TargetingReceipt {
  readonly revision: number;
  readonly savedAt: string;
  readonly selection: BroadcastRecipientSelection;
  readonly draft: BroadcastDraftSnapshot;
}

function targetingReceipt(value: unknown): TargetingReceipt {
  const root = record(value);
  const rawDraft = record(root.draft);
  const draft = broadcastDraftSnapshot(rawDraft);
  const selection = parseBroadcastRecipientSelection(
    rawDraft.recipientSelection,
  );
  if (
    (selection === null && draft.audience_kind !== null) ||
    (selection !== null && draft.audience_kind !== "recipient_expression")
  )
    throw new TypeError("selection audience mismatch");
  return {
    revision: positiveInteger(root.revision),
    savedAt: text(root.savedAt),
    selection,
    draft,
  };
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("text required");
  }
  return value;
}

function invalidReceipt(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "unknown");
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
