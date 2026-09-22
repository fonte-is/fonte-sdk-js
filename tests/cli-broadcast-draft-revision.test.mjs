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
const operationId = "correct-subject-v1";
const changes = { subject: "Corrected subject" };

test("bounded Broadcast revision sends one exact PATCH and validates Core readback", async () => {
  const requests = [];
  const client = createBroadcastDraftRevisionClient(async (path, options) => {
    requests.push({ path, options });
    return receipt(2);
  });

  const result = await client.reviseBroadcastDraft({
    workspace,
    draftId,
    baseRevision: 1,
    operationId,
    changes,
  });

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
  assert.deepEqual(result, {
    kind: "broadcast_draft_revision",
    draft_id: draftId,
    base_revision: 1,
    revision: 2,
    operation_id: operationId,
    saved_at: "2026-09-22T12:00:00.000Z",
    changes,
  });
});

test("revision receipts fail closed and keep ambiguous Core effect", async () => {
  const client = createBroadcastDraftRevisionClient(async () => ({
    ...receipt(2),
    draft: { ...receipt(2).draft, subject: "different" },
  }));
  await assert.rejects(
    client.reviseBroadcastDraft({
      workspace,
      draftId,
      baseRevision: 1,
      operationId,
      changes,
    }),
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

test("MCP schema rejects empty, content, targeting, and authority changes", () => {
  for (const changes of [
    {},
    { html_body: "<p>not admitted here</p>" },
    { recipient_selection: { to: { kind: "everyone" }, except: [] } },
    { sender: "not admitted here" },
  ]) {
    assert.equal(
      reviseBroadcastDraftInputSchema.safeParse({
        ...mcpInput(),
        changes,
      }).success,
      false,
    );
  }
});

test("bounded registration exposes only the idempotent draft-copy tool", async () => {
  const registrations = [];
  const server = {
    registerTool: (...args) => { registrations.push(args); },
  };
  registerMcpBroadcastDraftRevisionTool(server, async () => ({
    reviseBroadcastDraft: async () => ({
      kind: "broadcast_draft_revision",
      draft_id: draftId,
      base_revision: 1,
      revision: 2,
      operation_id: operationId,
      saved_at: "2026-09-22T12:00:00.000Z",
      changes,
    }),
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
  assert.equal(result.structuredContent.revision.revision, 2);
  assert.equal(result.content[0].text, JSON.stringify(result.structuredContent));
});

function mcpInput() {
  return {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: operationId,
    changes,
  };
}

function receipt(revision) {
  return {
    revision,
    savedAt: "2026-09-22T12:00:00.000Z",
    draft: {
      broadcastDraftId: draftId,
      version: revision,
      title: "Synthetic draft",
      subject: "Corrected subject",
      preheader: null,
    },
  };
}
