import {
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";

export interface BroadcastDraftRevisionChanges {
  readonly title?: string | null;
  readonly subject?: string | null;
  readonly preheader?: string | null;
  readonly textBody?: string | null;
  readonly activeSource?: "composer" | "html";
  readonly composerBody?: string | null;
  readonly htmlBody?: string | null;
}

export type BroadcastDraftJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BroadcastDraftJsonValue[]
  | { readonly [key: string]: BroadcastDraftJsonValue };

export interface BroadcastDraftRevisionSnapshot {
  readonly draft_id: string;
  readonly revision: number;
  readonly source_campaign_id: string | null;
  readonly source_broadcast_id: string | null;
  readonly title: string | null;
  readonly sender_profile_id: string | null;
  readonly reply_to: string | null;
  readonly audience_kind:
    | "all_contacts"
    | "contact_import"
    | "recipient_expression"
    | null;
  readonly audience_contact_import_batch_id: string | null;
  readonly recipient_expression: BroadcastDraftJsonValue;
  readonly recipient_selection: BroadcastDraftJsonValue;
  readonly communication_purpose_id: string | null;
  readonly communication_purpose_name: string | null;
  readonly subject: string | null;
  readonly preheader: string | null;
  readonly text_body: string | null;
  readonly active_source: "composer" | "html";
  readonly composer_body: string | null;
  readonly html_body: string | null;
  readonly created_at: string;
  readonly updated_at: string;
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
  readonly draft: BroadcastDraftRevisionSnapshot;
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
  readonly draft: BroadcastDraftRevisionSnapshot;
  readonly rawDraft: Record<string, unknown>;
}

function revisionReceipt(value: unknown): RevisionReceipt {
  const root = record(value);
  const rawDraft = record(root.draft);
  const sourceCampaignId = optionalNullableText(rawDraft.sourceCampaignId);
  const sourceBroadcastId = optionalNullableText(
    rawDraft.sourceMarketingBroadcastId,
  );
  if ((sourceCampaignId === null) !== (sourceBroadcastId === null)) {
    throw new TypeError("campaign lineage must be complete");
  }
  const draft: BroadcastDraftRevisionSnapshot = {
    draft_id: text(rawDraft.broadcastDraftId),
    revision: positiveInteger(rawDraft.version),
    source_campaign_id: sourceCampaignId,
    source_broadcast_id: sourceBroadcastId,
    title: nullableText(rawDraft.title),
    sender_profile_id: nullableText(rawDraft.sender),
    reply_to: nullableText(rawDraft.replyTo),
    audience_kind: audienceKind(rawDraft.audienceKind),
    audience_contact_import_batch_id: nullableText(
      rawDraft.audienceContactImportBatchId,
    ),
    recipient_expression: jsonValue(rawDraft.recipientExpression),
    recipient_selection: jsonValue(rawDraft.recipientSelection),
    communication_purpose_id: nullableText(
      rawDraft.communicationPurposeId,
    ),
    communication_purpose_name: nullableText(rawDraft.subscriptionName),
    subject: nullableText(rawDraft.subject),
    preheader: nullableText(rawDraft.preheader),
    text_body: nullableText(rawDraft.textBody),
    active_source: activeSource(rawDraft.activeSource),
    composer_body: nullableText(rawDraft.composerBody),
    html_body: nullableText(rawDraft.htmlBody),
    created_at: text(rawDraft.createdAt),
    updated_at: text(rawDraft.updatedAt),
  };
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

function audienceKind(
  value: unknown,
): BroadcastDraftRevisionSnapshot["audience_kind"] {
  if (
    value === null ||
    value === "all_contacts" ||
    value === "contact_import" ||
    value === "recipient_expression"
  ) {
    return value;
  }
  throw new TypeError("audience kind invalid");
}

function activeSource(
  value: unknown,
): BroadcastDraftRevisionSnapshot["active_source"] {
  if (value === "composer" || value === "html") return value;
  throw new TypeError("active source invalid");
}

function jsonValue(value: unknown): BroadcastDraftJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  const input = record(value);
  return Object.fromEntries(
    Object.entries(input).map(([key, item]) => [key, jsonValue(item)]),
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

function optionalNullableText(value: unknown): string | null {
  return value === undefined ? null : nullableText(value);
}

function nullableText(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new TypeError("nullable text required");
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
