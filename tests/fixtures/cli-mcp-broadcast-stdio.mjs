import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { HostedTestBlockedError } from "../../packages/cli/dist/hosted-errors.js";
import {
  createDurableFonteMcpSession,
  createFonteMcpServer,
  MCP_FONTE_TOOLS,
} from "../../packages/cli/dist/mcp-sequence-server.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000151";
const testId = "00000000-0000-4000-8000-000000000152";
const sendRequestId = "00000000-0000-4000-8000-000000000154";
const sendOperationId = "00000000-0000-4000-8000-000000000155";
const senderId = "sender_synthetic_primary";
const digest = `sha256:${"c".repeat(64)}`;
const html =
  "<!doctype html><p>Hello {{{contact.email}}}</p>" +
  '<a href="{{{unsubscribe_url}}}">Leave</a>';
let currentHtml = html;
let currentRevision = 1;
let currentSender = null;
let currentReplyTo = null;
let currentSource = {
  title: "Synthetic draft",
  subject: "Synthetic subject",
  preheader: "Synthetic preheader",
  activeSource: "html",
  composerBody: null,
  htmlBody: html,
};
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
    // Eleven authoring/read steps precede logout. Retired Send-now performs no auth/Core call.
    if (authorizations > 11) {
      throw new HostedTestBlockedError("login_required");
    }
    return "synthetic-stdio-broadcast-bearer";
  },
});
const readinessReader = {
  async inspectHost() {
    return { initialized: true, tools: MCP_FONTE_TOOLS };
  },
  async readSession() {
    return {
      status: { state: "ready", serverCheck: "not_checked" },
      storageAvailable: true,
    };
  },
  async listWorkspaces() {
    return (await session.workspaceCatalog())
      .listWorkspaces()
      .then((values) => values.map(({ slug, name }) => ({ slug, name })));
  },
  async readSelectedWorkspace() {
    return workspace;
  },
};
const server = createFonteMcpServer(session, readinessReader);
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
  if (init.method === "GET" && path === "/v1/workspaces") {
    return response({
      workspaces: [
        {
          workspaceId: "workspace-synthetic",
          tenantId: "workspace-synthetic",
          accountId: "account-synthetic",
          slug: workspace,
          workspaceSlug: workspace,
          workspaceCode: "northstar",
          displayName: "Fonte",
          role: "owner",
          availableEnvironments: ["production"],
          localBootstrapIdentity: null,
        },
      ],
    });
  }
  if (
    init.method === "POST" &&
    path ===
      `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}` +
        "/send-intent?environment=production"
  ) {
    if (
      new Headers(init.headers).get("idempotency-key") !== sendRequestId ||
      JSON.stringify(body) !==
        JSON.stringify({
          schema: "broadcast_send_intent.v3",
          requestId: sendRequestId,
          executionRail: "canonical_execution_cell_v1",
          expectedDraftVersion: 4,
          timing: { mode: "now" },
        })
    )
      return response({ error: "broadcast_send_intent_invalid" }, 400);
    return response(
      { status: "accepted", operation: sendOperation(), replayed: false },
      202,
    );
  }
  if (
    init.method === "GET" &&
    path ===
      `/v1/workspaces/${workspace}/delivery/sender-domains` +
        "?environment=production"
  ) {
    return response(
      bound({
        senderProfiles: [
          {
            senderId,
            fromName: "Synthetic Sender",
            emailAddress: "sender@example.test",
            defaultReplyTo: "reply@example.test",
          },
        ],
      }),
    );
  }
  if (
    init.method === "POST" &&
    path ===
      `/v1/workspaces/${workspace}/broadcast-drafts` + "?environment=production"
  ) {
    currentHtml = body.htmlBody;
    currentRevision = 1;
    currentSender = body.sender;
    currentReplyTo = body.replyTo;
    currentSource = body;
    return response(lifecycleReceipt("applied"));
  }
  if (
    init.method === "GET" &&
    path ===
      `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}` +
        "?environment=production"
  )
    return response(lifecycleReceipt(null));
  if (
    init.method === "PATCH" &&
    path ===
      `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}` +
        "?environment=production"
  ) {
    return response(
      Object.hasOwn(body.changes, "recipientSelection")
        ? targetingReceipt(body)
        : revisionReceipt(body),
    );
  }
  if (
    init.method === "POST" &&
    path ===
      `/v1/workspaces/${workspace}/marketing-broadcasts/${draftId}` +
        "/send-approvals?environment=production"
  ) {
    if (body.operation === "render_preview") return response(renderReceipt());
    if (body.operation === "send_test_to_verified_account") {
      return response(testRequestReceipt());
    }
  }
  if (
    init.method === "GET" &&
    path ===
      `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}` +
        `/test-deliveries/${testId}?environment=production`
  )
    return response(testReadReceipt());
  return response({ error: "synthetic_route_missing" }, 404);
}

function sendOperation() {
  return {
    schema: "broadcast_send_operation.v2",
    operationId: sendOperationId,
    scope: {
      workspaceId: "workspace-internal",
      environment: "production",
      draftId,
    },
    instructionGeneration: 1,
    approvalGeneration: 1,
    acceptedAt: "2026-09-22T16:00:00.000Z",
    timing: { mode: "now" },
    notBefore: "2026-09-22T16:00:00.000Z",
    phase: "queued",
    reason: null,
    retryable: true,
    nextAttemptAt: "2026-09-22T16:00:01.000Z",
    total: null,
    timestamps: {
      preparationStartedAt: null,
      snapshotAt: null,
      authorizationCommittedAt: null,
      firstSubmissionAt: null,
      terminalAt: null,
    },
    delivery: {
      status: "unavailable",
      reason: "provider_submission_not_started",
      observedAt: null,
    },
    requiredAction: null,
    allowedActions: ["cancel"],
    executionAuthorized: false,
    replayed: false,
  };
}

function revisionReceipt(body) {
  if (Object.hasOwn(body.changes, "htmlBody")) {
    currentHtml = body.changes.htmlBody;
  }
  if (Object.hasOwn(body.changes, "sender")) {
    currentSender = body.changes.sender;
  }
  if (Object.hasOwn(body.changes, "replyTo")) {
    currentReplyTo = body.changes.replyTo;
  }
  currentRevision = body.baseRevision + 1;
  return {
    revision: currentRevision,
    savedAt: "2026-09-22T14:00:00.000Z",
    draft: draft(currentHtml, currentRevision, "2026-09-22T14:00:00.000Z"),
  };
}

function targetingReceipt(body) {
  const recipientSelection = body.changes.recipientSelection;
  currentRevision = body.baseRevision + 1;
  return {
    revision: currentRevision,
    savedAt: "2026-09-22T15:00:00.000Z",
    draft: draft(
      currentHtml,
      currentRevision,
      "2026-09-22T15:00:00.000Z",
      {},
      recipientSelection,
    ),
  };
}

function lifecycleReceipt(outcome) {
  return bound({
    outcome,
    draft: draft(
      currentHtml,
      currentRevision,
      "2026-09-22T13:00:00.000Z",
      currentSource,
    ),
  });
}

function draft(
  htmlBody,
  version,
  updatedAt,
  source = {},
  recipientSelection = null,
) {
  return {
    broadcastDraftId: draftId,
    version,
    title: source.title ?? "Synthetic draft",
    sender: currentSender,
    replyTo: currentReplyTo,
    audienceKind: recipientSelection === null ? null : "recipient_expression",
    audienceContactImportBatchId: null,
    recipientExpression:
      recipientSelection === null
        ? null
        : {
            include: [{ kind: "everyone" }],
            exclude: recipientSelection.except,
          },
    recipientSelection,
    communicationPurposeId: null,
    subscriptionName: null,
    subject: source.subject ?? "Synthetic subject",
    preheader: source.preheader ?? "Synthetic preheader",
    textBody: htmlBody,
    activeSource: source.activeSource ?? "html",
    composerBody: source.composerBody ?? null,
    htmlBody,
    createdAt: "2026-09-22T13:00:00.000Z",
    updatedAt,
    latestTestMarketingBroadcastId: null,
    sendProgress: null,
    sendReceipt: null,
  };
}

function renderReceipt() {
  return bound({
    broadcastDraftId: draftId,
    status: "preview",
    senderId: currentSender ?? senderId,
    renderContentDigest: digest,
    html: currentHtml,
    text: currentHtml,
    renderProof: proof(currentRevision),
    render: {
      subject: "Synthetic subject",
      replyTo: null,
      preheader: "Synthetic preheader",
      textBody: currentHtml,
      postalAddress: null,
      clickTrackingEnabled: true,
    },
    sampleRender: {
      recipientEmail: "preview-recipient@example.invalid",
      unsubscribeUrl: "https://preview.invalid/unsubscribe/preview",
      postalAddress: null,
      finalizerVersion: "fonte-core-recipient-finalizer-v2",
      html: sample(currentHtml),
      text: sample(currentHtml),
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
    renderProof: proof(currentRevision),
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
      testDraftVersion: currentRevision,
      currentVersion: currentRevision,
      versionUnchangedSinceTest: true,
    },
    renderProof: proof(currentRevision),
  });
}

function proof(version = 2) {
  return {
    source: "html",
    templateIdentity: "complete_html_v1",
    templateRevision: "fonte-core-render-v2",
    broadcastVersion: version,
    rendererVersion: "fonte-core-email-renderer-v2",
    recipientSlotSchemaVersion: "fonte-core-recipient-slots-v1",
    finalizerVersion: "fonte-core-recipient-finalizer-v2",
    textSource: "draft",
    renderHash: digest,
  };
}

function sample(value) {
  return value
    .replaceAll("{{{contact.email}}}", "preview-recipient@example.invalid")
    .replaceAll(
      "{{{unsubscribe_url}}}",
      "https://preview.invalid/unsubscribe/preview",
    )
    .replaceAll("{{{postal_address}}}", "");
}

function bound(value) {
  return {
    tenantId: "workspace-synthetic",
    environment: "production",
    ...value,
  };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
