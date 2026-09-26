export type BroadcastDraftJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BroadcastDraftJsonValue[]
  | { readonly [key: string]: BroadcastDraftJsonValue };

export interface BroadcastDraftSnapshot {
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

export function broadcastDraftSnapshot(value: unknown): BroadcastDraftSnapshot {
  const draft = record(value);
  const sourceCampaignId = optionalNullableText(draft.sourceCampaignId);
  const sourceBroadcastId = optionalNullableText(
    draft.sourceMarketingBroadcastId,
  );
  if ((sourceCampaignId === null) !== (sourceBroadcastId === null)) {
    throw new TypeError("campaign lineage must be complete");
  }
  return {
    draft_id: text(draft.broadcastDraftId),
    revision: positiveInteger(draft.version),
    source_campaign_id: sourceCampaignId,
    source_broadcast_id: sourceBroadcastId,
    title: nullableText(draft.title),
    sender_profile_id: nullableText(draft.sender),
    reply_to: nullableText(draft.replyTo),
    audience_kind: audienceKind(draft.audienceKind),
    audience_contact_import_batch_id: nullableText(
      draft.audienceContactImportBatchId,
    ),
    recipient_expression: jsonValue(draft.recipientExpression),
    recipient_selection: jsonValue(draft.recipientSelection),
    communication_purpose_id: nullableText(draft.communicationPurposeId),
    communication_purpose_name: nullableText(draft.subscriptionName),
    subject: nullableText(draft.subject),
    preheader: nullableText(draft.preheader),
    text_body: nullableText(draft.textBody),
    active_source: activeSource(draft.activeSource),
    composer_body: nullableText(draft.composerBody),
    html_body: nullableText(draft.htmlBody),
    created_at: text(draft.createdAt),
    updated_at: text(draft.updatedAt),
  };
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("object required");
  }
  return value as Record<string, unknown>;
}

export function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("positive integer required");
  }
  return value as number;
}

function audienceKind(value: unknown): BroadcastDraftSnapshot["audience_kind"] {
  if (
    value === null || value === "all_contacts" || value === "contact_import"
    || value === "recipient_expression"
  ) return value;
  throw new TypeError("audience kind invalid");
}

function activeSource(value: unknown): BroadcastDraftSnapshot["active_source"] {
  if (value === "composer" || value === "html") return value;
  throw new TypeError("active source invalid");
}

function jsonValue(value: unknown): BroadcastDraftJsonValue {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, item]) => [key, jsonValue(item)]),
  );
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
