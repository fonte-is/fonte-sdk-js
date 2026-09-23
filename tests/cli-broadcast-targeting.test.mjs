import assert from "node:assert/strict";
import test from "node:test";

import { registerMcpBroadcastTargetingTool } from "../packages/cli/dist/mcp-broadcast-targeting-registration.js";
import {
  broadcastRecipientSelectionSchema,
  updateBroadcastTargetingInputSchema,
} from "../packages/cli/dist/mcp-broadcast-targeting-types.js";
import { createBroadcastTargetingToolHandler } from "../packages/cli/dist/mcp-broadcast-targeting-tools.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import { parseBroadcastRecipientSelection } from "../packages/cli/dist/operator-broadcast-targeting-selection.js";
import { createBroadcastTargetingClient as createClient } from "../packages/cli/dist/operator-broadcast-targeting-client.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000171";
const systemId = "00000000-0000-4000-8000-000000000172";
const setId = "00000000-0000-4000-8000-000000000173";
const selection = {
  to: { kind: "everyone" },
  except: [
    { kind: "system", systemId },
    { kind: "one_time", oneTimeSetId: setId },
    { kind: "email_domain", domain: "blocked.example.test" },
  ],
};

test("Everyone and exact Except references use one fenced draft mutation", async () => {
  const requests = [];
  const client = createClient(async (path, options) => {
    requests.push({ path, options });
    return receipt(selection);
  });
  const result = await client.updateBroadcastTargeting(input(selection));
  assert.deepEqual(result.recipient_selection, selection);
  assert.equal(result.revision, 2);
  assert.equal(result.draft.html_body, "<p>Preserved HTML</p>");
  assert.equal(result.draft.sender_profile_id, "sender_preserved");
  assert.equal(
    result.draft.communication_purpose_id,
    "00000000-0000-4000-8000-000000000174",
  );
  assert.deepEqual(requests, [
    {
      path:
        `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}` +
        "?environment=production",
      options: {
        method: "PATCH",
        lostResponseEffect: "unknown",
        body: {
          baseRevision: 1,
          mutationKey: "target-everyone-except-v1",
          changes: { recipientSelection: selection },
        },
      },
    },
  ]);
});

test("empty Except, incomplete To, and explicit clear persist distinctly", async () => {
  const values = [
    { to: { kind: "everyone" }, except: [] },
    {
      to: { kind: "selected", references: [] },
      except: [{ kind: "system", systemId }],
    },
    null,
  ];
  for (const recipientSelection of values) {
    const client = createClient(async () => receipt(recipientSelection));
    const saved = await client.updateBroadcastTargeting(
      input(recipientSelection),
    );
    assert.deepEqual(saved.recipient_selection, recipientSelection);
  }
});

test("same operation replays while stale and lost outcomes remain truthful", async () => {
  const replay = createClient(async () => receipt(selection));
  assert.deepEqual(
    await replay.updateBroadcastTargeting(input(selection)),
    await replay.updateBroadcastTargeting(input(selection)),
  );

  const stale = createBroadcastTargetingToolHandler(async () => ({
    updateBroadcastTargeting: async () => {
      throw new CoreOperatorError(
        "broadcast_draft_version_conflict",
        409,
        "none",
      );
    },
  }));
  assert.deepEqual(await stale(mcpInput(selection)), {
    outcome: "conflict",
    reason: "broadcast_draft_version_conflict",
    status_code: 409,
    core_effect: "none",
    targeting: null,
  });

  const lost = createBroadcastTargetingToolHandler(async () => ({
    updateBroadcastTargeting: async () => {
      throw new CoreOperatorError("core_api_unavailable", null, "unknown");
    },
  }));
  assert.equal((await lost(mcpInput(selection))).outcome, "ambiguous");
  assert.equal((await lost(mcpInput(selection))).core_effect, "unknown");
});

test("selection contract distinguishes empty, incomplete, clear, and missing", () => {
  assert.equal(
    broadcastRecipientSelectionSchema.safeParse({
      to: { kind: "everyone" },
      except: [],
    }).success,
    true,
  );
  const incomplete = {
    to: { kind: "selected", references: [] },
    except: [{ kind: "system", systemId }],
  };
  assert.deepEqual(parseBroadcastRecipientSelection(incomplete), incomplete);
  assert.equal(
    updateBroadcastTargetingInputSchema.safeParse({
      ...mcpInput(selection),
      recipient_selection: null,
    }).success,
    true,
  );
  const { recipient_selection: _missing, ...missing } = mcpInput(selection);
  assert.equal(
    updateBroadcastTargetingInputSchema.safeParse(missing).success,
    false,
  );
  for (const invalid of [
    { to: { kind: "everyone" } },
    {
      to: { kind: "everyone" },
      except: [
        { kind: "system", systemId },
        { kind: "system", systemId },
      ],
    },
    {
      to: { kind: "selected", references: [{ kind: "system", systemId }] },
      except: [{ kind: "system", systemId }],
    },
    { to: { kind: "everyone", references: [] }, except: [] },
  ])
    assert.equal(
      broadcastRecipientSelectionSchema.safeParse(invalid).success,
      false,
    );
});

test("registration exposes only the bounded stable-definition mutation", async () => {
  const registrations = [];
  const server = {
    registerTool: (...args) => {
      registrations.push(args);
    },
  };
  registerMcpBroadcastTargetingTool(server, async () => ({
    updateBroadcastTargeting: async () => result(selection),
  }));
  assert.deepEqual(
    registrations.map(([name]) => name),
    ["fonte_update_broadcast_targeting"],
  );
  assert.equal(registrations[0][1].annotations.idempotentHint, true);
  assert.equal(registrations[0][1].annotations.readOnlyHint, false);
  const response = await registrations[0][2](mcpInput(selection));
  assert.equal(response.structuredContent.outcome, "completed");
  assert.equal(
    response.content[0].text,
    JSON.stringify(response.structuredContent),
  );
});

function input(recipientSelection) {
  return {
    workspace,
    draftId,
    baseRevision: 1,
    operationId: "target-everyone-except-v1",
    recipientSelection,
  };
}

function mcpInput(recipientSelection) {
  return {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: "target-everyone-except-v1",
    recipient_selection: recipientSelection,
  };
}

function result(recipientSelection) {
  return {
    kind: "broadcast_targeting_revision",
    draft_id: draftId,
    base_revision: 1,
    revision: 2,
    operation_id: "target-everyone-except-v1",
    saved_at: "2026-09-22T15:00:00.000Z",
    recipient_selection: recipientSelection,
    draft: snapshot(recipientSelection),
  };
}

function receipt(recipientSelection) {
  return {
    revision: 2,
    savedAt: "2026-09-22T15:00:00.000Z",
    draft: coreDraft(recipientSelection),
  };
}

function snapshot(recipientSelection) {
  return {
    draft_id: draftId,
    revision: 2,
    source_campaign_id: "00000000-0000-4000-8000-000000000175",
    source_broadcast_id: "00000000-0000-4000-8000-000000000176",
    title: "Preserved title",
    sender_profile_id: "sender_preserved",
    reply_to: null,
    audience_kind: recipientSelection === null ? null : "recipient_expression",
    audience_contact_import_batch_id: null,
    recipient_expression:
      recipientSelection === null
        ? null
        : { include: [{ kind: "everyone" }], exclude: [] },
    recipient_selection: recipientSelection,
    communication_purpose_id: "00000000-0000-4000-8000-000000000174",
    communication_purpose_name: "Product updates",
    subject: "Preserved subject",
    preheader: "Preserved preheader",
    text_body: "<p>Preserved HTML</p>",
    active_source: "html",
    composer_body: null,
    html_body: "<p>Preserved HTML</p>",
    created_at: "2026-09-22T14:00:00.000Z",
    updated_at: "2026-09-22T15:00:00.000Z",
  };
}

function coreDraft(recipientSelection) {
  const draft = snapshot(recipientSelection);
  return {
    broadcastDraftId: draft.draft_id,
    sourceCampaignId: draft.source_campaign_id,
    sourceMarketingBroadcastId: draft.source_broadcast_id,
    version: draft.revision,
    title: draft.title,
    sender: draft.sender_profile_id,
    replyTo: draft.reply_to,
    audienceKind: draft.audience_kind,
    audienceContactImportBatchId: draft.audience_contact_import_batch_id,
    recipientExpression: draft.recipient_expression,
    recipientSelection: draft.recipient_selection,
    communicationPurposeId: draft.communication_purpose_id,
    subscriptionName: draft.communication_purpose_name,
    subject: draft.subject,
    preheader: draft.preheader,
    textBody: draft.text_body,
    activeSource: draft.active_source,
    composerBody: draft.composer_body,
    htmlBody: draft.html_body,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
  };
}
