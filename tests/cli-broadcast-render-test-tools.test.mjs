import assert from "node:assert/strict";
import test from "node:test";

import {
  createBroadcastRenderToolHandler,
  createBroadcastTestReadToolHandler,
  createBroadcastTestRequestToolHandler,
} from "../packages/cli/dist/mcp-broadcast-render-test-tools.js";
import {
  renderBroadcastDraftInputSchema,
  renderBroadcastDraftOutputSchema,
} from "../packages/cli/dist/mcp-broadcast-render-types.js";
import {
  readBroadcastTestOutputSchema,
  requestBroadcastTestInputSchema,
  requestBroadcastTestOutputSchema,
} from "../packages/cli/dist/mcp-broadcast-test-types.js";
import {
  registerMcpBroadcastRenderTestTools,
} from "../packages/cli/dist/mcp-broadcast-render-test-registration.js";
import { CoreOperatorError } from
  "../packages/cli/dist/operator-core-request.js";

const workspace = "fonte-synthetic";
const draftId = "00000000-0000-4000-8000-000000000141";
const testId = "00000000-0000-4000-8000-000000000142";
const operationId = "synthetic-test-v4";
const digest = `sha256:${"b".repeat(64)}`;

test("bounded MCP inputs admit proof only and reject caller delivery content", () => {
  assert.equal(renderBroadcastDraftInputSchema.safeParse(renderInput()).success, true);
  assert.equal(requestBroadcastTestInputSchema.safeParse(testInput()).success, true);
  for (const foreign of [
    { html_body: "<p>caller MIME</p>" },
    { text_body: "caller MIME" },
    { recipient: "other@example.test" },
  ]) {
    assert.equal(requestBroadcastTestInputSchema.safeParse({
      ...testInput(),
      ...foreign,
    }).success, false);
  }
});

test("MCP handlers preserve render proof across preview, test, and readback", async () => {
  const calls = [];
  const provider = async () => ({
    renderBroadcastDraft: async (input) => {
      calls.push(["render", input]);
      return renderResult();
    },
    requestBroadcastTest: async (input) => {
      calls.push(["request", input]);
      return requestResult();
    },
    readBroadcastTest: async (input) => {
      calls.push(["read", input]);
      return readResult();
    },
  });
  const rendered = await createBroadcastRenderToolHandler(provider)(renderInput());
  const requested = await createBroadcastTestRequestToolHandler(provider)(testInput());
  const read = await createBroadcastTestReadToolHandler(provider)(readInput());

  assert.equal(rendered.render.sample_render.finalizer_version,
    rendered.render.render_proof.finalizer_version);
  assert.deepEqual(requested.test_request.render_proof,
    rendered.render.render_proof);
  assert.equal(read.test_result.provider_outcome, "accepted");
  assert.equal(read.test_result.delivery_outcome, "delivered");
  assert.equal(read.test_result.inbox_confirmation, "unavailable");
  assert.deepEqual(calls, [
    ["render", { workspace, draftId, revision: 4 }],
    ["request", {
      workspace,
      draftId,
      revision: 4,
      operationId,
      renderProof: proof(),
    }],
    ["read", { workspace, draftId, testId }],
  ]);
  renderBroadcastDraftOutputSchema.parse(rendered);
  requestBroadcastTestOutputSchema.parse(requested);
  readBroadcastTestOutputSchema.parse(read);
});

test("MCP handlers distinguish conflicts from unknown mutation effect", async () => {
  const conflict = createBroadcastRenderToolHandler(async () => ({
    renderBroadcastDraft: async () => {
      throw new CoreOperatorError("broadcast_send_conflict", 409, "none");
    },
  }));
  assert.deepEqual(await conflict(renderInput()), {
    outcome: "conflict",
    reason: "broadcast_send_conflict",
    status_code: 409,
    core_effect: "none",
    render: null,
  });

  const ambiguous = createBroadcastTestRequestToolHandler(async () => ({
    requestBroadcastTest: async () => {
      throw new CoreOperatorError("core_api_unavailable", null, "unknown");
    },
  }));
  assert.deepEqual(await ambiguous(testInput()), {
    outcome: "ambiguous",
    reason: "core_api_unavailable",
    status_code: null,
    core_effect: "unknown",
    test_request: null,
  });
});

test("registration exposes only render, safe test request, and test readback", async () => {
  const registrations = [];
  const server = {
    registerTool: (...args) => { registrations.push(args); },
  };
  registerMcpBroadcastRenderTestTools(server, async () => ({
    renderBroadcastDraft: async () => renderResult(),
    requestBroadcastTest: async () => requestResult(),
    readBroadcastTest: async () => readResult(),
  }));

  assert.deepEqual(registrations.map(([name]) => name), [
    "fonte_render_broadcast_draft",
    "fonte_request_broadcast_test",
    "fonte_read_broadcast_test",
  ]);
  assert.equal(registrations[0][1].annotations.readOnlyHint, true);
  assert.equal(registrations[1][1].annotations.readOnlyHint, false);
  assert.equal(registrations[1][1].annotations.idempotentHint, true);
  const response = await registrations[1][2](testInput());
  assert.equal(response.structuredContent.test_request.test_id, testId);
  assert.equal(response.content[0].text,
    JSON.stringify(response.structuredContent));
});

function renderInput() {
  return { workspace, draft_id: draftId, revision: 4 };
}

function testInput() {
  return {
    workspace,
    draft_id: draftId,
    revision: 4,
    operation_id: operationId,
    render_proof: proof(),
  };
}

function readInput() {
  return { workspace, draft_id: draftId, test_id: testId };
}

function proof() {
  return {
    source: "html",
    template_identity: "complete_html_v1",
    template_revision: "fonte-core-render-v2",
    broadcast_version: 4,
    renderer_version: "fonte-core-email-renderer-v2",
    recipient_slot_schema_version: "fonte-core-recipient-slots-v1",
    finalizer_version: "fonte-core-recipient-finalizer-v2",
    text_source: "draft",
    render_hash: digest,
  };
}

function renderResult() {
  return {
    kind: "broadcast_draft_render",
    draft_id: draftId,
    revision: 4,
    sender_profile_id: "sender_synthetic",
    render_content_digest: digest,
    subject: "Synthetic subject",
    reply_to: null,
    preheader: "Synthetic preheader",
    postal_address: null,
    click_tracking_enabled: true,
    html: "<p>Hello {{{contact.email}}}</p>",
    text: "Hello {{{contact.email}}}",
    render_proof: proof(),
    sample_render: {
      recipient_email: "preview-recipient@example.invalid",
      unsubscribe_url: "https://preview.invalid/unsubscribe/preview",
      postal_address: null,
      finalizer_version: proof().finalizer_version,
      html: "<p>Hello preview-recipient@example.invalid</p>",
      text: "Hello preview-recipient@example.invalid",
    },
  };
}

function requestResult() {
  return {
    kind: "broadcast_test_request",
    draft_id: draftId,
    test_id: testId,
    revision: 4,
    operation_id: operationId,
    replayed: false,
    render_proof: proof(),
  };
}

function readResult() {
  return {
    kind: "broadcast_test_result",
    draft_id: draftId,
    test_id: testId,
    revision: 4,
    status: "terminal",
    poll_after_milliseconds: null,
    feedback_observations_may_change: true,
    accepted_count: 1,
    refused_count: 0,
    unknown_count: 0,
    provider_submission_status: "accepted",
    provider_outcome: "accepted",
    delivery_outcome: "delivered",
    inbox_confirmation: "unavailable",
    provider_message_id: "synthetic-provider-message",
    feedback: {
      recipient_result_count: 1,
      provider_accepted_count: 1,
      delivered_count: 1,
      delivery_delayed_count: 0,
      bounced_count: 0,
      complained_count: 0,
      rejected_count: 0,
      rendering_failed_count: 0,
    },
    version_unchanged_since_test: true,
    render_proof: proof(),
  };
}
