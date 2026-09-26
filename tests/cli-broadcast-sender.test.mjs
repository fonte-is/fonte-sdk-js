import assert from "node:assert/strict";
import test from "node:test";

import {
  listBroadcastSendersInputSchema,
  updateBroadcastSenderInputSchema,
} from "../packages/cli/dist/mcp-broadcast-sender-types.js";
import {
  createListBroadcastSendersToolHandler,
  createUpdateBroadcastSenderToolHandler,
} from "../packages/cli/dist/mcp-broadcast-sender-tools.js";
import { registerMcpBroadcastSenderTools } from "../packages/cli/dist/mcp-broadcast-sender-registration.js";
import { createBroadcastSenderClient } from "../packages/cli/dist/operator-broadcast-sender-client.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import {
  catalogReceipt,
  draftId,
  operationId,
  recipientSelection,
  revisionResult,
  senderId,
  senderProfile,
  updateInput,
  workspace,
} from "./fixtures/broadcast-sender-values.mjs";

test("verified sender catalog uses the exact production GET and selects one profile", async () => {
  const requests = [];
  const client = createBroadcastSenderClient(async (path, options) => {
    requests.push({ path, options });
    return catalogReceipt([senderProfile()]);
  }, revisionClient());

  const result = await client.listBroadcastSenders({ workspace, match: null });

  assert.deepEqual(requests, [
    {
      path: `/v1/workspaces/${workspace}/delivery/sender-domains?environment=production`,
      options: undefined,
    },
  ]);
  assert.deepEqual(result, {
    kind: "broadcast_sender_catalog",
    sender_profiles: [
      {
        sender_profile_id: senderId,
        name: "Synthetic Sender",
        email: "sender@example.test",
        default_reply_to: "reply@example.test",
      },
    ],
    resolution: {
      outcome: "selected",
      sender_profile_id: senderId,
      candidate_sender_profile_ids: [senderId],
    },
  });
});

test("sender resolution exact-matches name or email and never guesses", async () => {
  const profiles = [
    senderProfile(),
    senderProfile({
      senderId: "sender_synthetic_secondary",
      fromName: "Second Sender",
      emailAddress: "second@example.test",
    }),
  ];
  const client = createBroadcastSenderClient(
    async () => catalogReceipt(profiles),
    revisionClient(),
  );

  const ambiguous = await client.listBroadcastSenders({
    workspace,
    match: null,
  });
  assert.deepEqual(ambiguous.resolution, {
    outcome: "ambiguous",
    sender_profile_id: null,
    candidate_sender_profile_ids: [senderId, "sender_synthetic_secondary"],
  });
  const byName = await client.listBroadcastSenders({
    workspace,
    match: "synthetic sender",
  });
  assert.equal(byName.resolution.outcome, "selected");
  assert.equal(byName.resolution.sender_profile_id, senderId);
  const byEmail = await client.listBroadcastSenders({
    workspace,
    match: "SECOND@EXAMPLE.TEST",
  });
  assert.equal(
    byEmail.resolution.sender_profile_id,
    "sender_synthetic_secondary",
  );
  const missing = await client.listBroadcastSenders({
    workspace,
    match: "missing@example.test",
  });
  assert.deepEqual(missing.resolution, {
    outcome: "not_found",
    sender_profile_id: null,
    candidate_sender_profile_ids: [],
  });
});

test("catalog rejects unbounded or human domain-management response fields", async () => {
  const client = createBroadcastSenderClient(
    async () => ({
      ...catalogReceipt([senderProfile()]),
      senderProfiles: [{ ...senderProfile(), providerSecret: "not-exposed" }],
    }),
    revisionClient(),
  );
  await assert.rejects(
    client.listBroadcastSenders({ workspace, match: null }),
    (error) => {
      assert.equal(error.reason, "core_operator_receipt_invalid");
      assert.equal(error.coreEffect, "none");
      return true;
    },
  );
});

test("sender binding reuses one revision client and preserves unrelated state", async () => {
  const calls = [];
  const expected = revisionResult();
  const client = createBroadcastSenderClient(
    async () => catalogReceipt([senderProfile()]),
    {
      reviseBroadcastDraft: async (input) => {
        calls.push(input);
        return expected;
      },
    },
  );

  const result = await client.updateBroadcastSender({
    workspace,
    draftId,
    baseRevision: 4,
    operationId,
    senderProfileId: senderId,
    replyTo: "explicit@example.test",
  });

  assert.deepEqual(calls, [
    {
      workspace,
      draftId,
      baseRevision: 4,
      operationId,
      changes: {
        sender: senderId,
        replyTo: "explicit@example.test",
      },
    },
  ]);
  assert.equal(result, expected);
  assert.equal(result.draft.html_body, "<!doctype html><p>Preserved</p>");
  assert.deepEqual(result.draft.recipient_selection, recipientSelection());
  assert.equal(
    result.draft.source_campaign_id,
    "00000000-0000-4000-8000-000000000704",
  );
});

test("omitted reply-to preserves it and mutation failures remain truthful", async () => {
  const delegated = [];
  const success = createUpdateBroadcastSenderToolHandler(async () =>
    createBroadcastSenderClient(async () => catalogReceipt([]), {
      reviseBroadcastDraft: async (input) => {
        delegated.push(input);
        return revisionResult();
      },
    }),
  );
  const input = updateInput();
  assert.equal((await success(input)).outcome, "completed");
  assert.deepEqual(delegated[0].changes, { sender: senderId });

  const conflict = createUpdateBroadcastSenderToolHandler(async () => ({
    listBroadcastSenders: async () => {
      throw new Error("unused");
    },
    updateBroadcastSender: async () => {
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

  const lost = createUpdateBroadcastSenderToolHandler(async () => ({
    listBroadcastSenders: async () => {
      throw new Error("unused");
    },
    updateBroadcastSender: async () => {
      throw new CoreOperatorError("core_api_unavailable", null, "unknown");
    },
  }));
  assert.deepEqual(await lost(input), {
    outcome: "ambiguous",
    reason: "core_api_unavailable",
    status_code: null,
    core_effect: "unknown",
    revision: null,
  });
});

test("catalog read failures have no Core effect", async () => {
  const handler = createListBroadcastSendersToolHandler(async () => ({
    listBroadcastSenders: async () => {
      throw new CoreOperatorError(
        "sender_domain_authority_unavailable",
        503,
        "none",
      );
    },
    updateBroadcastSender: async () => {
      throw new Error("unused");
    },
  }));
  assert.deepEqual(await handler({ workspace, match: null }), {
    outcome: "unavailable",
    reason: "sender_domain_authority_unavailable",
    status_code: 503,
    core_effect: "none",
    catalog: null,
  });
});

test("schemas and registration expose only the two bounded sender tools", async () => {
  assert.equal(
    listBroadcastSendersInputSchema.safeParse({ workspace, match: null })
      .success,
    true,
  );
  assert.equal(
    updateBroadcastSenderInputSchema.safeParse(updateInput()).success,
    true,
  );
  assert.equal(
    updateBroadcastSenderInputSchema.safeParse({
      ...updateInput(),
      sender_profile_id: "",
    }).success,
    false,
  );
  assert.equal(
    updateBroadcastSenderInputSchema.safeParse({
      ...updateInput(),
      reply_to: "Not-Canonical@Example.Test",
    }).data.reply_to,
    "not-canonical@example.test",
  );
  assert.equal(
    updateBroadcastSenderInputSchema.safeParse({
      ...updateInput(),
      send: true,
    }).success,
    false,
  );

  const registrations = [];
  registerMcpBroadcastSenderTools(
    { registerTool: (...args) => registrations.push(args) },
    async () => ({
      listBroadcastSenders: async () => ({
        kind: "broadcast_sender_catalog",
        sender_profiles: [],
        resolution: {
          outcome: "not_found",
          sender_profile_id: null,
          candidate_sender_profile_ids: [],
        },
      }),
      updateBroadcastSender: async () => revisionResult(),
    }),
  );
  assert.deepEqual(
    registrations.map(([name]) => name),
    ["fonte_list_broadcast_senders", "fonte_update_broadcast_sender"],
  );
  assert.equal(registrations[0][1].annotations.readOnlyHint, true);
  assert.equal(registrations[1][1].annotations.idempotentHint, true);
  const listed = await registrations[0][2]({ workspace, match: null });
  assert.equal(
    listed.structuredContent.catalog.resolution.outcome,
    "not_found",
  );
  const updated = await registrations[1][2](updateInput());
  assert.equal(updated.structuredContent.revision.revision, 5);
});

function revisionClient() {
  return { reviseBroadcastDraft: async () => revisionResult() };
}
