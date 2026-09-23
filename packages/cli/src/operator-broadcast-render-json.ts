import {
  absoluteHttpsUrl,
  boolean,
  content,
  nullableText,
  productionBody,
  renderDigest,
  renderProof,
  record,
  text,
  uuid,
} from "./operator-broadcast-render-values.js";
import type {
  BroadcastDraftRenderResult,
  BroadcastSampleRender,
} from "./operator-broadcast-render-test-types.js";

export function broadcastRender(value: unknown): BroadcastDraftRenderResult {
  const body = productionBody(value);
  if (body.status !== "preview") throw new TypeError("preview status required");
  const html = content(body.html);
  const renderedText = content(body.text);
  const digest = renderDigest(body.renderContentDigest);
  const proof = renderProof(body.renderProof);
  const render = record(body.render);
  const sample = record(body.sampleRender);
  const postalAddress = nullableText(render.postalAddress);
  const sampleRender: BroadcastSampleRender = {
    recipient_email: text(sample.recipientEmail),
    unsubscribe_url: absoluteHttpsUrl(sample.unsubscribeUrl),
    postal_address: nullableText(sample.postalAddress),
    finalizer_version: text(sample.finalizerVersion),
    html: content(sample.html),
    text: content(sample.text),
  };
  if (
    proof.render_hash !== digest || proof.text_source !== "draft"
    || render.textBody !== renderedText
    || sampleRender.finalizer_version !== proof.finalizer_version
    || sampleRender.postal_address !== postalAddress
    || sampleRender.html.includes("{{{") || sampleRender.text.includes("{{{")
  ) throw new TypeError("render receipt identities do not reconcile");
  return {
    kind: "broadcast_draft_render",
    draft_id: uuid(body.broadcastDraftId),
    revision: proof.broadcast_version,
    sender_profile_id: text(body.senderId),
    render_content_digest: digest,
    subject: text(render.subject),
    reply_to: nullableText(render.replyTo),
    preheader: nullableText(render.preheader),
    postal_address: postalAddress,
    click_tracking_enabled: boolean(render.clickTrackingEnabled),
    html,
    text: renderedText,
    render_proof: proof,
    sample_render: sampleRender,
  };
}
