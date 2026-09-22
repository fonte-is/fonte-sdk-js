import assert from "node:assert/strict";
import test from "node:test";

import {
  createBroadcastRenderTestClient,
} from "../packages/cli/dist/operator-broadcast-render-test-client.js";
import { CoreOperatorError } from
  "../packages/cli/dist/operator-core-request.js";

const workspace = "fonte-synthetic";
const draftId = "00000000-0000-4000-8000-000000000131";
const testId = "00000000-0000-4000-8000-000000000132";
const operationId = "synthetic-test-v3";
const digest = `sha256:${"a".repeat(64)}`;
const canonicalHtml = "<!doctype html><p>Hello {{{contact.email}}}</p>"
  + '<a href="{{{unsubscribe_url}}}">Leave</a>';

test("render then test uses one Core proof and never accepts caller MIME", async () => {
  const requests = [];
  const responses = [renderReceipt(), queuedReceipt(), readback("terminal", 0)];
  const client = createBroadcastRenderTestClient(async (path, options) => {
    requests.push({ path, options });
    return responses.shift();
  });

  const render = await client.renderBroadcastDraft({
    workspace,
    draftId,
    revision: 3,
  });
  assert.equal(render.html, canonicalHtml);
  assert.match(render.sample_render.html, /preview-recipient@example\.invalid/);
  assert.doesNotMatch(render.sample_render.html, /\{\{\{/);

  const requested = await client.requestBroadcastTest({
    workspace,
    draftId,
    revision: 3,
    operationId,
    renderProof: render.render_proof,
  });
  assert.equal(requested.test_id, testId);
  assert.deepEqual(requested.render_proof, render.render_proof);

  const result = await client.readBroadcastTest({ workspace, draftId, testId });
  assert.equal(result.provider_outcome, "accepted");
  assert.equal(result.delivery_outcome, "unknown");
  assert.equal(result.inbox_confirmation, "unavailable");
  assert.equal(result.feedback_observations_may_change, true);

  assert.deepEqual(requests[0], {
    path: approvalPath(),
    options: {
      lostResponseEffect: "none",
      body: {
        operation: "render_preview",
        expectedVersion: 3,
        postalAddress: null,
      },
    },
  });
  assert.deepEqual(requests[1], {
    path: approvalPath(),
    options: {
      idempotencyKey: operationId,
      lostResponseEffect: "unknown",
      body: {
        operation: "send_test_to_verified_account",
        expectedVersion: 3,
        postalAddress: null,
        idempotencyKey: operationId,
        expectedRenderContentDigest: digest,
      },
    },
  });
  assert.equal("htmlBody" in requests[1].options.body, false);
  assert.equal("textBody" in requests[1].options.body, false);
  assert.equal("recipients" in requests[1].options.body, false);
  assert.equal(requests[2].options, undefined);
});

test("test readback distinguishes delivered and provider-unknown outcomes", async () => {
  for (const [receipt, provider, delivery] of [
    [readback("terminal", 1), "accepted", "delivered"],
    [readback("unknown", 0), "unknown", "unknown"],
  ]) {
    const client = createBroadcastRenderTestClient(async () => receipt);
    const result = await client.readBroadcastTest({ workspace, draftId, testId });
    assert.equal(result.provider_outcome, provider);
    assert.equal(result.delivery_outcome, delivery);
    assert.equal(result.inbox_confirmation, "unavailable");
  }
});

test("test response proof mismatch stays ambiguous after mutation", async () => {
  const client = createBroadcastRenderTestClient(async () => ({
    ...queuedReceipt(),
    renderProof: { ...coreProof(), rendererVersion: "changed-after-test" },
  }));
  await assert.rejects(
    client.requestBroadcastTest({
      workspace,
      draftId,
      revision: 3,
      operationId,
      renderProof: sdkProof(),
    }),
    (error) => {
      assert.equal(error.reason, "core_operator_receipt_invalid");
      assert.equal(error.coreEffect, "unknown");
      return true;
    },
  );
});

test("stale render and lost test response preserve Core recovery truth", async () => {
  const stale = createBroadcastRenderTestClient(async () => {
    throw new CoreOperatorError("broadcast_send_conflict", 409, "none");
  });
  await assert.rejects(
    stale.renderBroadcastDraft({ workspace, draftId, revision: 2 }),
    (error) => error.reason === "broadcast_send_conflict"
      && error.coreEffect === "none",
  );

  const lost = createBroadcastRenderTestClient(async () => {
    throw new CoreOperatorError("core_api_unavailable", null, "unknown");
  });
  await assert.rejects(
    lost.requestBroadcastTest({
      workspace,
      draftId,
      revision: 3,
      operationId,
      renderProof: sdkProof(),
    }),
    (error) => error.reason === "core_api_unavailable"
      && error.coreEffect === "unknown",
  );
});

function renderReceipt() {
  return bound({
    broadcastDraftId: draftId,
    status: "preview",
    senderId: "sender_synthetic",
    renderContentDigest: digest,
    html: canonicalHtml,
    text: canonicalHtml,
    renderProof: coreProof(),
    render: {
      subject: "Synthetic subject",
      replyTo: null,
      preheader: "Synthetic preheader",
      textBody: canonicalHtml,
      postalAddress: null,
      clickTrackingEnabled: true,
    },
    sampleRender: {
      recipientEmail: "preview-recipient@example.invalid",
      unsubscribeUrl: "https://preview.invalid/unsubscribe/preview",
      postalAddress: null,
      finalizerVersion: "fonte-core-recipient-finalizer-v2",
      html: canonicalHtml
        .replaceAll("{{{contact.email}}}", "preview-recipient@example.invalid")
        .replaceAll(
          "{{{unsubscribe_url}}}",
          "https://preview.invalid/unsubscribe/preview",
        ),
      text: canonicalHtml
        .replaceAll("{{{contact.email}}}", "preview-recipient@example.invalid")
        .replaceAll(
          "{{{unsubscribe_url}}}",
          "https://preview.invalid/unsubscribe/preview",
        ),
    },
  });
}

function queuedReceipt() {
  return bound({
    broadcastDraftId: draftId,
    marketingBroadcastId: testId,
    recipientSnapshotId: "synthetic-snapshot",
    sendPlanDecisionId: "synthetic-decision",
    status: "queued",
    deliveryKind: "test",
    billingEffect: "ordinary_email_usage_authority",
    submittedCount: 1,
    acceptedCount: 1,
    refusedCount: 0,
    unknownCount: 0,
    created: true,
    renderProof: coreProof(),
  });
}

function readback(status, deliveredCount) {
  const accepted = status === "terminal" ? 1 : 0;
  return bound({
    broadcastDraftId: draftId,
    marketingBroadcastId: testId,
    deliveryKind: "test",
    statusScope: "provider_submission_and_billing",
    status,
    pollAfterMilliseconds: status === "terminal" ? null : 1_000,
    feedbackObservationsMayChange: true,
    submittedCount: 1,
    acceptedCount: accepted,
    refusedCount: 0,
    unknownCount: accepted ? 0 : 1,
    outbox: {
      providerSubmissionStatus: accepted ? "accepted" : "unknown",
      providerMessageId: accepted ? "synthetic-provider-message" : null,
    },
    feedback: {
      recipientResultCount: deliveredCount,
      providerAcceptedCount: accepted,
      deliveredCount,
      deliveryDelayedCount: 0,
      bouncedCount: 0,
      complainedCount: 0,
      rejectedCount: 0,
      renderingFailedCount: 0,
    },
    originalDraft: {
      testDraftVersion: 3,
      currentVersion: 3,
      versionUnchangedSinceTest: true,
    },
    renderProof: coreProof(),
  });
}

function coreProof() {
  return {
    source: "html",
    templateIdentity: "complete_html_v1",
    templateRevision: "fonte-core-render-v2",
    broadcastVersion: 3,
    rendererVersion: "fonte-core-email-renderer-v2",
    recipientSlotSchemaVersion: "fonte-core-recipient-slots-v1",
    finalizerVersion: "fonte-core-recipient-finalizer-v2",
    textSource: "draft",
    renderHash: digest,
  };
}

function sdkProof() {
  return {
    source: "html",
    template_identity: "complete_html_v1",
    template_revision: "fonte-core-render-v2",
    broadcast_version: 3,
    renderer_version: "fonte-core-email-renderer-v2",
    recipient_slot_schema_version: "fonte-core-recipient-slots-v1",
    finalizer_version: "fonte-core-recipient-finalizer-v2",
    text_source: "draft",
    render_hash: digest,
  };
}

function approvalPath() {
  return `/v1/workspaces/${workspace}/marketing-broadcasts/${draftId}`
    + "/send-approvals?environment=production";
}

function bound(value) {
  return { tenantId: "workspace-synthetic", environment: "production", ...value };
}
