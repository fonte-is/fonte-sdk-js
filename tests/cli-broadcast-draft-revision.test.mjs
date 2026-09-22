import assert from "node:assert/strict";
import test from "node:test";

import {
  createBroadcastDraftRevisionClient,
} from "../packages/cli/dist/operator-broadcast-draft-revision-client.js";
import {
  createBroadcastDraftRevisionToolHandler,
} from "../packages/cli/dist/mcp-broadcast-draft-revision-tools.js";
import {
  reviseBroadcastDraftInputSchema,
} from "../packages/cli/dist/mcp-broadcast-draft-revision-types.js";
import {
  registerMcpBroadcastDraftRevisionTool,
} from "../packages/cli/dist/mcp-broadcast-draft-revision-registration.js";
import { CoreOperatorError } from
  "../packages/cli/dist/operator-core-request.js";

const workspace = "fonte-synthetic";
const draftId = "00000000-0000-4000-8000-000000000031";
const campaignId = "00000000-0000-4000-8000-000000000032";
const sourceBroadcastId = "00000000-0000-4000-8000-000000000033";
const collectionId = "00000000-0000-4000-8000-000000000034";
const operationId = "replace-html-v1";
const htmlA = "<!doctype html><html><body>HTML A</body></html>";
const htmlB = "<!doctype html><html><body>HTML B</body></html>";
const changes = { activeSource: "html", htmlBody: htmlB };

test("same-draft HTML revision sends exact PATCH and returns preserved Core state", async () => {
  const requests = [];
  const client = createBroadcastDraftRevisionClient(async (path, options) => {
    requests.push({ path, options });
    return receipt(2);
  });

  const result = await client.reviseBroadcastDraft(revisionInput());

  assert.deepEqual(requests, [{
    path: `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}?environment=production`,
    options: {
      method: "PATCH",
      lostResponseEffect: "unknown",
      body: {
        baseRevision: 1,
        mutationKey: operationId,
        changes,
      },
    },
  }]);
  assert.deepEqual(result, revisionResult());
  assert.equal(result.draft.html_body, htmlB);
  assert.equal(result.draft.revision, 2);
  assert.equal(result.draft.sender_profile_id, "sender_synthetic");
  assert.equal(result.draft.source_campaign_id, campaignId);
  assert.deepEqual(result.draft.recipient_selection, recipientSelection());
});

test("same mutation identity recovers the same draft and revision", async () => {
  let requests = 0;
  const client = createBroadcastDraftRevisionClient(async (path, options) => {
    requests += 1;
    assert.match(path, new RegExp(`${draftId}\\?environment=production$`));
    assert.equal(options.body.mutationKey, operationId);
    return receipt(2);
  });

  const first = await client.reviseBroadcastDraft(revisionInput());
  const replay = await client.reviseBroadcastDraft(revisionInput());

  assert.equal(requests, 2);
  assert.deepEqual(replay, first);
  assert.equal(replay.draft_id, draftId);
  assert.equal(replay.revision, 2);
});

test("revision receipts fail closed and keep ambiguous Core effect", async () => {
  const client = createBroadcastDraftRevisionClient(async () => ({
    ...receipt(2),
    draft: { ...receipt(2).draft, htmlBody: htmlA, textBody: htmlA },
  }));
  await assert.rejects(
    client.reviseBroadcastDraft(revisionInput()),
    (error) => {
      assert.equal(error.reason, "core_operator_receipt_invalid");
      assert.equal(error.coreEffect, "unknown");
      return true;
    },
  );
});

test("MCP handler preserves revision conflicts and lost-response ambiguity", async () => {
  const input = mcpInput();
  const conflict = createBroadcastDraftRevisionToolHandler(async () => ({
    reviseBroadcastDraft: async () => {
      throw new CoreOperatorError(
        "broadcast_draft_version_conflict",
        409,
        "none",
      );
    },
  }));
  assert.deepEqual(await conflict(input), {
    outcome: "conflict",
    reason: "broadcast_draft_version_conflict",
    status_code: 409,
    core_effect: "none",
    revision: null,
  });

  const ambiguous = createBroadcastDraftRevisionToolHandler(async () => ({
    reviseBroadcastDraft: async () => {
      throw new CoreOperatorError("core_api_unavailable", null, "unknown");
    },
  }));
  assert.deepEqual(await ambiguous(input), {
    outcome: "ambiguous",
    reason: "core_api_unavailable",
    status_code: null,
    core_effect: "unknown",
    revision: null,
  });
});

test("MCP schema admits source HTML but rejects mixed or foreign authority", () => {
  assert.equal(reviseBroadcastDraftInputSchema.safeParse(mcpInput()).success, true);
  assert.equal(reviseBroadcastDraftInputSchema.safeParse({
    ...mcpInput(),
    changes: { text_body: "Legacy active-source replacement" },
  }).success, true);
  assert.equal(reviseBroadcastDraftInputSchema.safeParse({
    ...mcpInput(),
    changes: {
      active_source: "composer",
      composer_body: "Composer replacement",
    },
  }).success, true);
  for (const candidateChanges of [
    {},
    { text_body: "legacy", html_body: htmlB },
    { recipient_selection: recipientSelection() },
    { sender: "not admitted here" },
  ]) {
    assert.equal(
      reviseBroadcastDraftInputSchema.safeParse({
        ...mcpInput(),
        changes: candidateChanges,
      }).success,
      false,
    );
  }
});

test("bounded registration exposes only the idempotent draft update tool", async () => {
  const registrations = [];
  const server = {
    registerTool: (...args) => { registrations.push(args); },
  };
  registerMcpBroadcastDraftRevisionTool(server, async () => ({
    reviseBroadcastDraft: async (input) => {
      assert.deepEqual(input.changes, changes);
      return revisionResult();
    },
  }));

  assert.equal(registrations.length, 1);
  const [name, definition, callback] = registrations[0];
  assert.equal(name, "fonte_update_broadcast_draft");
  assert.deepEqual(definition.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const result = await callback(mcpInput());
  assert.equal(result.structuredContent.outcome, "completed");
  assert.equal(result.structuredContent.revision.draft.html_body, htmlB);
  assert.equal(result.content[0].text, JSON.stringify(result.structuredContent));
});

function revisionInput() {
  return {
    workspace,
    draftId,
    baseRevision: 1,
    operationId,
    changes,
  };
}

function mcpInput() {
  return {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: operationId,
    changes: {
      active_source: "html",
      html_body: htmlB,
    },
  };
}

function revisionResult() {
  return {
    kind: "broadcast_draft_revision",
    draft_id: draftId,
    base_revision: 1,
    revision: 2,
    operation_id: operationId,
    saved_at: "2026-09-22T12:00:00.000Z",
    draft: draftSnapshot(),
  };
}

function receipt(revision) {
  return {
    revision,
    savedAt: "2026-09-22T12:00:00.000Z",
    draft: {
      broadcastDraftId: draftId,
      sourceCampaignId: campaignId,
      sourceMarketingBroadcastId: sourceBroadcastId,
      version: revision,
      title: "Synthetic draft",
      sender: "sender_synthetic",
      replyTo: "reply@example.test",
      audienceKind: "recipient_expression",
      audienceContactImportBatchId: null,
      recipientExpression: recipientExpression(),
      recipientSelection: recipientSelection(),
      communicationPurposeId: "purpose_synthetic",
      subscriptionName: "Synthetic updates",
      subject: "Synthetic subject",
      preheader: "Synthetic preheader",
      textBody: htmlB,
      activeSource: "html",
      composerBody: "Synthetic composer working copy",
      htmlBody: htmlB,
      createdAt: "2026-09-22T11:00:00.000Z",
      updatedAt: "2026-09-22T12:00:00.000Z",
    },
  };
}

function draftSnapshot() {
  return {
    draft_id: draftId,
    revision: 2,
    source_campaign_id: campaignId,
    source_broadcast_id: sourceBroadcastId,
    title: "Synthetic draft",
    sender_profile_id: "sender_synthetic",
    reply_to: "reply@example.test",
    audience_kind: "recipient_expression",
    audience_contact_import_batch_id: null,
    recipient_expression: recipientExpression(),
    recipient_selection: recipientSelection(),
    communication_purpose_id: "purpose_synthetic",
    communication_purpose_name: "Synthetic updates",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    text_body: htmlB,
    active_source: "html",
    composer_body: "Synthetic composer working copy",
    html_body: htmlB,
    created_at: "2026-09-22T11:00:00.000Z",
    updated_at: "2026-09-22T12:00:00.000Z",
  };
}

function recipientExpression() {
  return {
    include: [{ kind: "collection", collectionId }],
    exclude: [{ kind: "email_domain", domain: "blocked.example.test" }],
  };
}

function recipientSelection() {
  return {
    to: {
      kind: "selected",
      references: [{ kind: "collection", collectionId }],
    },
    except: [{ kind: "email_domain", domain: "blocked.example.test" }],
  };
}
