import { createBroadcastHtmlPreparationClient } from "../../packages/cli/dist/operator-broadcast-html-preparation.js";

export const workspace = "northstar";
export const draftId = "00000000-0000-4000-8000-000000000181";
const sourceFile = "/synthetic/broadcast.html";
const correctedFile = "/synthetic/broadcast-corrected.html";
const referenceFile = "/synthetic/reference.png";
export const htmlA =
  '<html><body style="font-family:Arial">A ' +
  '<a href="{{{unsubscribe_url}}}">Leave</a></body></html>';
export const htmlB = htmlA.replace("A ", "B ");

export function clientWith(overrides = {}) {
  const html = overrides.html ?? htmlA;
  return createBroadcastHtmlPreparationClient({
    readFile: async (file) => ({
      path: file,
      bytes: new TextEncoder().encode(
        file === referenceFile
          ? "reference"
          : file === correctedFile
            ? htmlB
            : html,
      ),
    }),
    lifecycle:
      overrides.lifecycle ??
      (async () => ({
        createBroadcastDraft: async () => lifecycle("applied", 1, html),
        readBroadcastDraft: async () => lifecycle(null, 1, html),
      })),
    revision:
      overrides.revision ??
      (async () => ({
        reviseBroadcastDraft: async () => revision(2, html),
      })),
    render:
      overrides.render ??
      (async () => ({
        renderBroadcastDraft: async () => render(1, html),
      })),
  });
}

export function prepareInput() {
  return {
    workspace,
    draftId,
    title: "Synthetic draft",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    ...sourceInput(sourceFile),
  };
}

export function reviseInput() {
  return {
    workspace,
    draftId,
    baseRevision: 1,
    operationId: "correct-html-v2",
    ...sourceInput(correctedFile),
  };
}

export function mcpPrepareInput() {
  return {
    workspace,
    draft_id: draftId,
    title: "Synthetic draft",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    source_file: sourceFile,
    reference_file: referenceFile,
    postal_address_literal: null,
    literal_fallbacks: {},
  };
}

export function mcpReviseInput() {
  return {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: "correct-html-v2",
    source_file: correctedFile,
    reference_file: referenceFile,
    postal_address_literal: null,
    literal_fallbacks: {},
  };
}

export function lifecycle(outcome, revisionNumber, html) {
  return {
    kind: "broadcast_draft",
    outcome,
    draft_id: draftId,
    revision: revisionNumber,
    draft: snapshot(revisionNumber, html),
  };
}

export function revision(revisionNumber, html) {
  return {
    kind: "broadcast_draft_revision",
    draft_id: draftId,
    base_revision: revisionNumber - 1,
    revision: revisionNumber,
    operation_id: "correct-html-v2",
    saved_at: "2026-09-22T16:00:00.000Z",
    draft: snapshot(revisionNumber, html),
  };
}

export function render(revisionNumber, html) {
  const proof = {
    source: "html",
    template_identity: "complete_html_v1",
    template_revision: "fonte-core-render-v2",
    broadcast_version: revisionNumber,
    renderer_version: "fonte-core-email-renderer-v2",
    recipient_slot_schema_version: "fonte-core-recipient-slots-v1",
    finalizer_version: "fonte-core-recipient-finalizer-v2",
    text_source: "draft",
    render_hash: `sha256:${"d".repeat(64)}`,
  };
  return {
    kind: "broadcast_draft_render",
    draft_id: draftId,
    revision: revisionNumber,
    sender_profile_id: "sender_preserved",
    render_content_digest: proof.render_hash,
    subject: "Synthetic subject",
    reply_to: null,
    preheader: "Synthetic preheader",
    postal_address: null,
    click_tracking_enabled: true,
    html,
    text: html,
    render_proof: proof,
    sample_render: {
      recipient_email: "preview@example.invalid",
      unsubscribe_url: "https://preview.invalid/unsubscribe",
      postal_address: null,
      finalizer_version: proof.finalizer_version,
      html,
      text: html,
    },
  };
}

function sourceInput(file) {
  return {
    sourceFile: file,
    referenceFile,
    postalAddressLiteral: null,
    literalFallbacks: {},
  };
}

function snapshot(revisionNumber, html) {
  return {
    draft_id: draftId,
    revision: revisionNumber,
    source_campaign_id: draftId,
    source_broadcast_id: draftId,
    title: "Synthetic draft",
    sender_profile_id: "sender_preserved",
    reply_to: null,
    audience_kind: "recipient_expression",
    audience_contact_import_batch_id: null,
    recipient_expression: { include: [{ kind: "everyone" }], exclude: [] },
    recipient_selection: {
      to: { kind: "everyone" },
      except: [{ kind: "system", systemId: draftId }],
    },
    communication_purpose_id: draftId,
    communication_purpose_name: "Product updates",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    text_body: html,
    active_source: "html",
    composer_body: null,
    html_body: html,
    created_at: "2026-09-22T15:00:00.000Z",
    updated_at: "2026-09-22T16:00:00.000Z",
  };
}
