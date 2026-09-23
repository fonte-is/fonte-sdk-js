import assert from "node:assert/strict";
import test from "node:test";

import {
  clientWith,
  draftId,
  htmlA,
  htmlB,
  lifecycle,
  prepareInput,
  render,
  reviseInput,
  revision,
  workspace,
} from "./fixtures/broadcast-html-preparation-values.mjs";

test("file prepare creates, reads and renders one exact stable draft", async () => {
  const calls = [];
  const client = clientWith({
    lifecycle: async () => ({
      createBroadcastDraft: async (input) => {
        calls.push(["create", input]);
        return lifecycle("applied", 1, htmlA);
      },
      readBroadcastDraft: async (input) => {
        calls.push(["read", input]);
        return lifecycle(null, 1, htmlA);
      },
    }),
    render: async () => ({
      renderBroadcastDraft: async (input) => {
        calls.push(["render", input]);
        return render(1, htmlA);
      },
    }),
  });
  const result = await client.prepareBroadcastHtml(prepareInput());
  assert.equal(result.kind, "broadcast_html_preparation");
  assert.equal(result.save.draft_id, draftId);
  assert.equal(result.readback.draft.html_body, htmlA);
  assert.equal(result.render.sample_render.html, htmlA);
  assert.deepEqual(calls, [
    [
      "create",
      {
        workspace,
        draftId,
        title: "Synthetic draft",
        subject: "Synthetic subject",
        preheader: "Synthetic preheader",
        activeSource: "html",
        composerBody: null,
        htmlBody: htmlA,
      },
    ],
    ["read", { workspace, draftId }],
    ["render", { workspace, draftId, revision: 1 }],
  ]);
});

test("file correction revises and renders the same draft only", async () => {
  const calls = [];
  const client = clientWith({
    revision: async () => ({
      reviseBroadcastDraft: async (input) => {
        calls.push(["revise", input]);
        return revision(2, htmlB);
      },
    }),
    lifecycle: async () => ({
      createBroadcastDraft: async () => assert.fail("unexpected create"),
      readBroadcastDraft: async (input) => {
        calls.push(["read", input]);
        return lifecycle(null, 2, htmlB);
      },
    }),
    render: async () => ({
      renderBroadcastDraft: async (input) => {
        calls.push(["render", input]);
        return render(2, htmlB);
      },
    }),
  });
  const result = await client.reviseBroadcastHtml(reviseInput());
  assert.equal(result.kind, "broadcast_html_preparation");
  assert.equal(result.save.draft.sender_profile_id, "sender_preserved");
  assert.deepEqual(result.save.draft.recipient_selection, {
    to: { kind: "everyone" },
    except: [{ kind: "system", systemId: draftId }],
  });
  assert.equal(result.save.draft.source_campaign_id, draftId);
  assert.deepEqual(calls[0], [
    "revise",
    {
      workspace,
      draftId,
      baseRevision: 1,
      operationId: "correct-html-v2",
      changes: { activeSource: "html", htmlBody: htmlB },
    },
  ]);
  assert.deepEqual(calls.slice(1), [
    ["read", { workspace, draftId }],
    ["render", { workspace, draftId, revision: 2 }],
  ]);
});

test("unsupported source blocks before authentication or Core", async () => {
  let providers = 0;
  const client = clientWith({
    html: "<p>{{{contact.first_name|Friend}}}</p>",
    lifecycle: async () => {
      providers += 1;
      throw new Error("not called");
    },
    revision: async () => {
      providers += 1;
      throw new Error("not called");
    },
    render: async () => {
      providers += 1;
      throw new Error("not called");
    },
  });
  const result = await client.prepareBroadcastHtml(prepareInput());
  assert.equal(result.kind, "broadcast_html_preparation_blocked");
  assert.equal(
    result.source.blockers[0],
    "broadcast_recipient_slot_unsupported",
  );
  assert.equal(providers, 0);
});
