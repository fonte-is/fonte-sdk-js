import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  broadcastDraftSnapshot,
  record,
  type BroadcastDraftSnapshot,
} from "./operator-broadcast-draft-snapshot.js";

export interface BroadcastDraftCreateInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly title: string | null;
  readonly subject: string | null;
  readonly preheader: string | null;
  readonly activeSource: "composer" | "html";
  readonly composerBody: string | null;
  readonly htmlBody: string | null;
}

export interface BroadcastDraftReadInput {
  readonly workspace: string;
  readonly draftId: string;
}

export interface BroadcastDraftLifecycleResult {
  readonly kind: "broadcast_draft";
  readonly outcome: "applied" | "no_change" | null;
  readonly draft_id: string;
  readonly revision: number;
  readonly draft: BroadcastDraftSnapshot;
}

export interface BroadcastDraftLifecycleClient {
  createBroadcastDraft(
    input: BroadcastDraftCreateInput,
  ): Promise<BroadcastDraftLifecycleResult>;
  readBroadcastDraft(
    input: BroadcastDraftReadInput,
  ): Promise<BroadcastDraftLifecycleResult>;
}

export function createBroadcastDraftLifecycleClient(
  request: CoreRequester,
): BroadcastDraftLifecycleClient {
  return {
    async createBroadcastDraft(input) {
      const activeBody = input.activeSource === "html"
        ? input.htmlBody
        : input.composerBody;
      const result = parseCoreReceipt(
        lifecycleReceipt,
        await request(
          `${workspacePath(input.workspace)}/broadcast-drafts?environment=production`,
          {
            idempotencyKey: input.draftId,
            lostResponseEffect: "unknown",
            body: {
              title: input.title,
              sender: null,
              replyTo: null,
              audienceKind: null,
              audienceContactImportBatchId: null,
              recipientExpression: null,
              communicationPurposeId: null,
              subscriptionName: null,
              subject: input.subject,
              preheader: input.preheader,
              textBody: activeBody,
              activeSource: input.activeSource,
              composerBody: input.composerBody,
              htmlBody: input.htmlBody,
            },
          },
        ),
        "unknown",
      );
      if (
        result.outcome === null || result.draft_id !== input.draftId
        || result.draft.title !== input.title
        || result.draft.subject !== input.subject
        || result.draft.preheader !== input.preheader
        || result.draft.active_source !== input.activeSource
        || result.draft.composer_body !== input.composerBody
        || result.draft.html_body !== input.htmlBody
        || result.draft.text_body !== activeBody
      ) invalid("unknown");
      return result;
    },

    async readBroadcastDraft(input) {
      const result = parseCoreReceipt(
        lifecycleReceipt,
        await request(
          `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}`
            + "?environment=production",
        ),
      );
      if (result.outcome !== null || result.draft_id !== input.draftId) {
        invalid("none");
      }
      return result;
    },
  };
}

function lifecycleReceipt(value: unknown): BroadcastDraftLifecycleResult {
  const root = record(value);
  if (root.environment !== "production") throw new TypeError("production required");
  const outcome = root.outcome;
  if (outcome !== null && outcome !== "applied" && outcome !== "no_change") {
    throw new TypeError("draft outcome invalid");
  }
  const draft = broadcastDraftSnapshot(root.draft);
  return {
    kind: "broadcast_draft",
    outcome,
    draft_id: draft.draft_id,
    revision: draft.revision,
    draft,
  };
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalid(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
