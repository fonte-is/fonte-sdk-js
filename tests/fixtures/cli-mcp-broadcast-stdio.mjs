import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { HostedTestBlockedError } from
  "../../packages/cli/dist/hosted-errors.js";
import {
  createDurableFonteMcpSession,
  createFonteMcpServer,
} from "../../packages/cli/dist/mcp-sequence-server.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000151";
const testId = "00000000-0000-4000-8000-000000000152";
const digest = `sha256:${"c".repeat(64)}`;
const html = "<!doctype html><p>Hello {{{contact.email}}}</p>"
  + '<a href="{{{unsubscribe_url}}}">Leave</a>';
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
let authorizations = 0;
const session = createDurableFonteMcpSession({
  configUrl,
  fetch: async (input, init = {}) => {
    if (String(input) === configUrl) return response(hosted);
    return route(new URL(String(input)), init);
  },
  authorize: async () => {
    authorizations += 1;
    if (authorizations > 4) {
      throw new HostedTestBlockedError("login_required");
    }
    return "synthetic-stdio-broadcast-bearer";
  },
});
const server = createFonteMcpServer(session);
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  }),
);

function route(url, init) {
  const path = `${url.pathname}${url.search}`;
  const body = init.body === undefined ? null : JSON.parse(init.body);
  const authorization = new Headers(init.headers).get("authorization");
  if (authorization !== "Bearer synthetic-stdio-broadcast-bearer") {
    return response({ error: "human_auth_invalid" }, 401);
  }
  if (
    init.method === "PATCH"
    && path === `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}`
      + "?environment=production"
  ) return response(revisionReceipt(body));
  if (
    init.method === "POST"
    && path === `/v1/workspaces/${workspace}/marketing-broadcasts/${draftId}`
      + "/send-approvals?environment=production"
  ) {
    if (body.operation === "render_preview") return response(renderReceipt());
    if (body.operation === "send_test_to_verified_account") {
      return response(testRequestReceipt());
    }
  }
  if (
    init.method === "GET"
    && path === `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}`
      + `/test-deliveries/${testId}?environment=production`
  ) return response(testReadReceipt());
  return response({ error: "synthetic_route_missing" }, 404);
}

function revisionReceipt(body) {
  const htmlBody = body.changes.htmlBody;
  return {
    revision: 2,
    savedAt: "2026-09-22T14:00:00.000Z",
    draft: {
      broadcastDraftId: draftId,
      sourceCampaignId: null,
      sourceMarketingBroadcastId: null,
      version: 2,
      title: "Synthetic draft",
      sender: "sender_synthetic",
      replyTo: null,
      audienceKind: "all_contacts",
      audienceContactImportBatchId: null,
      recipientExpression: null,
      recipientSelection: null,
      communicationPurposeId: null,
      subscriptionName: null,
      subject: "Synthetic subject",
      preheader: "Synthetic preheader",
      textBody: htmlBody,
      activeSource: body.changes.activeSource,
      composerBody: null,
      htmlBody,
      createdAt: "2026-09-22T13:00:00.000Z",
      updatedAt: "2026-09-22T14:00:00.000Z",
    },
  };
}

function renderReceipt() {
  return bound({
    broadcastDraftId: draftId,
    status: "preview",
    senderId: "sender_synthetic",
    renderContentDigest: digest,
    html,
    text: html,
    renderProof: proof(),
    render: {
      subject: "Synthetic subject",
      replyTo: null,
      preheader: "Synthetic preheader",
      textBody: html,
      postalAddress: null,
      clickTrackingEnabled: true,
    },
    sampleRender: {
      recipientEmail: "preview-recipient@example.invalid",
      unsubscribeUrl: "https://preview.invalid/unsubscribe/preview",
      postalAddress: null,
      finalizerVersion: "fonte-core-recipient-finalizer-v2",
      html: "<p>Hello preview-recipient@example.invalid</p>",
      text: "Hello preview-recipient@example.invalid",
    },
  });
}

function testRequestReceipt() {
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
    renderProof: proof(),
  });
}

function testReadReceipt() {
  return bound({
    broadcastDraftId: draftId,
    marketingBroadcastId: testId,
    deliveryKind: "test",
    statusScope: "provider_submission_and_billing",
    status: "terminal",
    pollAfterMilliseconds: null,
    feedbackObservationsMayChange: true,
    submittedCount: 1,
    acceptedCount: 1,
    refusedCount: 0,
    unknownCount: 0,
    outbox: {
      providerSubmissionStatus: "accepted",
      providerMessageId: "synthetic-provider-message",
    },
    feedback: {
      recipientResultCount: 1,
      providerAcceptedCount: 1,
      deliveredCount: 1,
      deliveryDelayedCount: 0,
      bouncedCount: 0,
      complainedCount: 0,
      rejectedCount: 0,
      renderingFailedCount: 0,
    },
    originalDraft: {
      testDraftVersion: 2,
      currentVersion: 2,
      versionUnchangedSinceTest: true,
    },
    renderProof: proof(),
  });
}

function proof() {
  return {
    source: "html",
    templateIdentity: "complete_html_v1",
    templateRevision: "fonte-core-render-v2",
    broadcastVersion: 2,
    rendererVersion: "fonte-core-email-renderer-v2",
    recipientSlotSchemaVersion: "fonte-core-recipient-slots-v1",
    finalizerVersion: "fonte-core-recipient-finalizer-v2",
    textSource: "draft",
    renderHash: digest,
  };
}

function bound(value) {
  return { tenantId: "workspace-synthetic", environment: "production", ...value };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
