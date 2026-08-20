import {
  preflightAudienceEvidence,
  preflightAudienceSource,
  preflightRecipientExpression,
} from "./operator-preflight-audience-json.js";
import {
  array,
  audienceKindValue,
  content,
  instant,
  invalid,
  nullableText,
  object,
  positiveInteger,
  requireProduction,
  text,
  uuid,
} from "./operator-production-json-values.js";
import type {
  ProductionAudienceOptionsResult,
  ProductionAudiencePreviewResult,
  ProductionDraftResult,
} from "./operator-production-types.js";

export function productionDraft(value: unknown): ProductionDraftResult {
  const envelope = object(value);
  requireProduction(envelope);
  const body = object(envelope.draft);
  const outcome = envelope.outcome;
  if (outcome !== null && outcome !== "applied" && outcome !== "no_change")
    invalid();
  const audienceKind = audienceKindValue(body.audienceKind);
  const expression =
    body.recipientExpression === null
      ? null
      : preflightRecipientExpression(body.recipientExpression);
  if ((audienceKind === "all_contacts") !== (expression === null)) invalid();
  return {
    kind: "broadcast_draft",
    outcome,
    draft_id: uuid(body.broadcastDraftId),
    version: positiveInteger(body.version),
    title: text(body.title, 100),
    subject: text(body.subject, 500),
    body: content(body.textBody, 750_000),
    preheader: nullableText(body.preheader, 500),
    sender_profile_id: text(body.sender, 500),
    reply_to: nullableText(body.replyTo, 320),
    communication_purpose_id: uuid(body.communicationPurposeId),
    communication_purpose_name: text(body.subscriptionName, 100),
    audience_kind: audienceKind,
    recipient_expression: expression,
    created_at: instant(body.createdAt),
    updated_at: instant(body.updatedAt),
  };
}

export function productionAudienceOptions(
  value: unknown,
): ProductionAudienceOptionsResult {
  const body = object(value);
  requireProduction(body);
  return {
    kind: "broadcast_audience_options",
    communication_purposes: array(body.communicationPurposes, 100).map(
      (item) => {
        const purpose = object(item);
        return {
          communication_purpose_id: uuid(purpose.communicationPurposeId),
          label: text(purpose.label, 100),
        };
      },
    ),
    sources: array(body.sources, 200).map(preflightAudienceSource),
  };
}

export function productionAudiencePreview(
  value: unknown,
): ProductionAudiencePreviewResult {
  const body = object(value);
  requireProduction(body);
  return {
    kind: "broadcast_audience_preview",
    draft_id: uuid(body.broadcastDraftId),
    communication_purpose_name: nullableText(
      body.communicationPurposeName,
      100,
    ),
    ...preflightAudienceEvidence(body),
  };
}
