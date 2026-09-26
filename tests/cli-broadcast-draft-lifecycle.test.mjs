import assert from "node:assert/strict";
import test from "node:test";

import {
  registerMcpBroadcastDraftLifecycleTools,
} from "../packages/cli/dist/mcp-broadcast-draft-lifecycle-registration.js";
import {
  createBroadcastDraftInputSchema,
} from "../packages/cli/dist/mcp-broadcast-draft-lifecycle-types.js";
import {
  createBroadcastDraftCreateToolHandler,
  createBroadcastDraftReadToolHandler,
} from "../packages/cli/dist/mcp-broadcast-draft-lifecycle-tools.js";
import {
  createBroadcastDraftLifecycleClient,
} from "../packages/cli/dist/operator-broadcast-draft-lifecycle-client.js";
import { CoreOperatorError } from
  "../packages/cli/dist/operator-core-request.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000161";
const html = "<!doctype html><html><body>Source A</body></html>";

test("content-first create and read use one exact incomplete draft", async () => {
  const requests = [];
  const responses = [receipt("applied"), receipt(null)];
  const client = createBroadcastDraftLifecycleClient(async (path, options) => {
    requests.push({ path, options });
    return responses.shift();
  });

  const created = await client.createBroadcastDraft(createInput());
  const read = await client.readBroadcastDraft({ workspace, draftId });
  assert.deepEqual(created.draft, read.draft);
  assert.equal(created.draft.html_body, html);
  assert.equal(created.draft.sender_profile_id, null);
  assert.equal(created.draft.audience_kind, null);
  assert.equal(created.draft.communication_purpose_id, null);
  assert.deepEqual(requests, [
    {
      path: `/v1/workspaces/${workspace}/broadcast-drafts?environment=production`,
      options: {
        idempotencyKey: draftId,
        lostResponseEffect: "unknown",
        body: {
          title: "Synthetic draft",
          sender: null,
          replyTo: null,
          audienceKind: null,
          audienceContactImportBatchId: null,
          recipientExpression: null,
          communicationPurposeId: null,
          subscriptionName: null,
          subject: "Synthetic subject",
          preheader: "Synthetic preheader",
          textBody: html,
          activeSource: "html",
          composerBody: null,
          htmlBody: html,
        },
      },
    },
    {
      path: `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}`
        + "?environment=production",
      options: undefined,
    },
  ]);
});

test("same create identity replays and lost create stays ambiguous", async () => {
  const replay = createBroadcastDraftLifecycleClient(async () =>
    receipt("no_change"));
  assert.equal(
    (await replay.createBroadcastDraft(createInput())).outcome,
    "no_change",
  );

  const lost = createBroadcastDraftLifecycleClient(async () => {
    throw new CoreOperatorError("core_api_unavailable", null, "unknown");
  });
  await assert.rejects(
    lost.createBroadcastDraft(createInput()),
    (error) => error.reason === "core_api_unavailable"
      && error.coreEffect === "unknown",
  );
});

test("MCP lifecycle stays bounded and preserves recovery truth", async () => {
  assert.equal(createBroadcastDraftInputSchema.safeParse(mcpCreateInput()).success,
    true);
  for (const foreign of [
    { sender_profile_id: "sender_synthetic" },
    { audience: { kind: "all_contacts" } },
    { recipient: "other@example.test" },
  ]) {
    assert.equal(createBroadcastDraftInputSchema.safeParse({
      ...mcpCreateInput(),
      ...foreign,
    }).success, false);
  }

  const create = createBroadcastDraftCreateToolHandler(async () => ({
    createBroadcastDraft: async () => lifecycleResult("applied"),
  }));
  assert.equal((await create(mcpCreateInput())).draft.draft_id, draftId);

  const denied = createBroadcastDraftReadToolHandler(async () => ({
    readBroadcastDraft: async () => {
      throw new CoreOperatorError("human_auth_workspace_access_denied", 403,
        "none");
    },
  }));
  assert.deepEqual(await denied({ workspace, draft_id: draftId }), {
    outcome: "denied",
    reason: "human_auth_workspace_access_denied",
    status_code: 403,
    core_effect: "none",
    draft: null,
  });
});

test("registration adds only create and exact read lifecycle tools", async () => {
  const registrations = [];
  const server = {
    registerTool: (...args) => { registrations.push(args); },
  };
  registerMcpBroadcastDraftLifecycleTools(server, async () => ({
    createBroadcastDraft: async () => lifecycleResult("applied"),
    readBroadcastDraft: async () => lifecycleResult(null),
  }));
  assert.deepEqual(registrations.map(([name]) => name), [
    "fonte_create_broadcast_draft",
    "fonte_read_broadcast_draft",
  ]);
  assert.equal(registrations[0][1].annotations.readOnlyHint, false);
  assert.equal(registrations[0][1].annotations.idempotentHint, true);
  assert.equal(registrations[1][1].annotations.readOnlyHint, true);
  const result = await registrations[0][2](mcpCreateInput());
  assert.equal(result.structuredContent.outcome, "completed");
  assert.equal(result.content[0].text,
    JSON.stringify(result.structuredContent));
});

function createInput() {
  return {
    workspace,
    draftId,
    title: "Synthetic draft",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    activeSource: "html",
    composerBody: null,
    htmlBody: html,
  };
}

function mcpCreateInput() {
  return {
    workspace,
    draft_id: draftId,
    title: "Synthetic draft",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    active_source: "html",
    composer_body: null,
    html_body: html,
  };
}

function lifecycleResult(outcome) {
  return {
    kind: "broadcast_draft",
    outcome,
    draft_id: draftId,
    revision: 1,
    draft: snapshot(),
  };
}

function receipt(outcome) {
  return {
    tenantId: "workspace-synthetic",
    environment: "production",
    outcome,
    draft: coreDraft(),
  };
}

function snapshot() {
  return {
    draft_id: draftId,
    revision: 1,
    source_campaign_id: null,
    source_broadcast_id: null,
    title: "Synthetic draft",
    sender_profile_id: null,
    reply_to: null,
    audience_kind: null,
    audience_contact_import_batch_id: null,
    recipient_expression: null,
    recipient_selection: null,
    communication_purpose_id: null,
    communication_purpose_name: null,
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    text_body: html,
    active_source: "html",
    composer_body: null,
    html_body: html,
    created_at: "2026-09-22T13:00:00.000Z",
    updated_at: "2026-09-22T13:00:00.000Z",
  };
}

function coreDraft() {
  return {
    broadcastDraftId: draftId,
    version: 1,
    title: "Synthetic draft",
    sender: null,
    replyTo: null,
    audienceKind: null,
    audienceContactImportBatchId: null,
    recipientExpression: null,
    recipientSelection: null,
    communicationPurposeId: null,
    subscriptionName: null,
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    textBody: html,
    activeSource: "html",
    composerBody: null,
    htmlBody: html,
    createdAt: "2026-09-22T13:00:00.000Z",
    updatedAt: "2026-09-22T13:00:00.000Z",
    latestTestMarketingBroadcastId: null,
    sendProgress: null,
    sendReceipt: null,
  };
}
