import assert from "node:assert/strict";
import test from "node:test";

import { registerMcpBroadcastHtmlPreparationTools } from "../packages/cli/dist/mcp-broadcast-html-preparation-registration.js";
import { broadcastHtmlPreparationOutputSchema } from "../packages/cli/dist/mcp-broadcast-html-preparation-types.js";
import {
  createBroadcastHtmlPrepareToolHandler,
  createBroadcastHtmlReviseToolHandler,
} from "../packages/cli/dist/mcp-broadcast-html-preparation-tools.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import {
  clientWith,
  draftId,
  htmlA,
  mcpPrepareInput,
  mcpReviseInput,
} from "./fixtures/broadcast-html-preparation-values.mjs";

test("tool receipts preserve stale, lost and post-save render truth", async () => {
  const stale = createBroadcastHtmlReviseToolHandler(async () =>
    clientWith({
      revision: async () => ({
        reviseBroadcastDraft: async () => {
          throw new CoreOperatorError(
            "broadcast_draft_version_conflict",
            409,
            "none",
          );
        },
      }),
    }),
  );
  const staleResult = await stale(mcpReviseInput());
  assert.equal(staleResult.outcome, "conflict");
  assert.equal(staleResult.reason, "broadcast_draft_version_conflict");
  assert.equal(staleResult.status_code, 409);
  assert.equal(staleResult.core_effect, "none");
  assert.equal(staleResult.stage, "save");
  assert.equal(staleResult.action, "revise");
  assert.match(staleResult.source.prepared_sha256, /^sha256:/);
  assert.equal(staleResult.save, null);
  assert.equal(staleResult.readback, null);
  assert.equal(staleResult.render, null);

  const lost = createBroadcastHtmlReviseToolHandler(async () =>
    clientWith({
      revision: async () => ({
        reviseBroadcastDraft: async () => {
          throw new CoreOperatorError("core_api_unavailable", null, "unknown");
        },
      }),
    }),
  );
  const lostResult = await lost(mcpReviseInput());
  assert.equal(lostResult.outcome, "ambiguous");
  assert.equal(lostResult.core_effect, "unknown");
  assert.equal(lostResult.stage, "save");

  const renderFailed = createBroadcastHtmlPrepareToolHandler(async () =>
    clientWith({
      render: async () => ({
        renderBroadcastDraft: async () => {
          throw new CoreOperatorError(
            "broadcast_sender_not_ready",
            409,
            "none",
          );
        },
      }),
    }),
  );
  const failed = await renderFailed(mcpPrepareInput());
  assert.equal(failed.outcome, "conflict");
  assert.equal(failed.stage, "render");
  assert.equal(failed.save.draft_id, draftId);
  assert.equal(failed.readback.draft.html_body, htmlA);
  assert.equal(failed.core_effect, "none");
  broadcastHtmlPreparationOutputSchema.parse(failed);
});

test("registration exposes only file create and same-draft correction", () => {
  const registrations = [];
  registerMcpBroadcastHtmlPreparationTools(
    {
      registerTool: (...args) => registrations.push(args),
    },
    async () => clientWith(),
  );
  assert.deepEqual(
    registrations.map(([name]) => name),
    ["fonte_prepare_broadcast_html_file", "fonte_revise_broadcast_html_file"],
  );
  assert.ok(
    registrations.every(
      ([, definition]) =>
        definition.annotations.idempotentHint &&
        !definition.annotations.readOnlyHint,
    ),
  );
});
