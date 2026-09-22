export const workspace = "fonte-synthetic";
export const draftId = "00000000-0000-4000-8000-000000000703";
export const senderId = "sender_synthetic_primary";
export const operationId = "bind-synthetic-sender-v1";

export function catalogReceipt(senderProfiles) {
  return {
    tenantId: "workspace-synthetic",
    environment: "production",
    senderProfiles,
  };
}

export function senderProfile(overrides = {}) {
  return {
    senderId,
    fromName: "Synthetic Sender",
    emailAddress: "sender@example.test",
    defaultReplyTo: "reply@example.test",
    ...overrides,
  };
}

export function updateInput() {
  return {
    workspace,
    draft_id: draftId,
    base_revision: 4,
    operation_id: operationId,
    sender_profile_id: senderId,
  };
}

export function revisionResult() {
  return {
    kind: "broadcast_draft_revision",
    draft_id: draftId,
    base_revision: 4,
    revision: 5,
    operation_id: operationId,
    saved_at: "2026-09-22T16:00:00.000Z",
    draft: {
      draft_id: draftId,
      revision: 5,
      source_campaign_id: "00000000-0000-4000-8000-000000000704",
      source_broadcast_id: "00000000-0000-4000-8000-000000000705",
      title: "Synthetic draft",
      sender_profile_id: senderId,
      reply_to: "reply@example.test",
      audience_kind: "recipient_expression",
      audience_contact_import_batch_id: null,
      recipient_expression: {
        include: [{ kind: "everyone" }],
        exclude: recipientSelection().except,
      },
      recipient_selection: recipientSelection(),
      communication_purpose_id: "purpose_synthetic",
      communication_purpose_name: "Synthetic updates",
      subject: "Synthetic subject",
      preheader: "Synthetic preheader",
      text_body: "<!doctype html><p>Preserved</p>",
      active_source: "html",
      composer_body: null,
      html_body: "<!doctype html><p>Preserved</p>",
      created_at: "2026-09-22T15:00:00.000Z",
      updated_at: "2026-09-22T16:00:00.000Z",
    },
  };
}

export function recipientSelection() {
  return {
    to: { kind: "everyone" },
    except: [
      {
        kind: "system",
        systemId: "00000000-0000-4000-8000-000000000706",
      },
    ],
  };
}
