import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

import { MCP_FONTE_ALLOWLIST } from "../packages/cli/dist/mcp-sequence-server.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000151";
const testId = "00000000-0000-4000-8000-000000000152";
const operationId = "synthetic-test-composition-v2";
const systemId = "00000000-0000-4000-8000-000000000153";
const sendRequestId = "00000000-0000-4000-8000-000000000154";
const sendOperationId = "00000000-0000-4000-8000-000000000155";
const senderId = "sender_synthetic_primary";
const digest = `sha256:${"c".repeat(64)}`;
const html =
  "<!doctype html><p>Hello {{{contact.email}}}</p>" +
  '<a href="{{{unsubscribe_url}}}">Leave</a>';

test("fresh fonte-mcp prepares and corrects a local HTML file", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fonte-mcp-html-"));
  const sourceFile = path.join(directory, "source.html");
  const correctedFile = path.join(directory, "corrected.html");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(sourceFile, htmlWith("Source A"));
  await writeFile(correctedFile, htmlWith("Source B"));
  const child = await startMcp();
  t.after(() => child.close());
  await child.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fonte-file-test", version: "1.0.0" },
  });
  child.notify("notifications/initialized", {});

  const prepared = await call(child, "fonte_prepare_broadcast_html_file", {
    workspace,
    draft_id: draftId,
    title: "Synthetic draft",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    source_file: sourceFile,
    reference_file: null,
    postal_address_literal: null,
    literal_fallbacks: {},
  });
  assert.equal(prepared.outcome, "completed");
  assert.equal(prepared.stage, "complete");
  assert.equal(prepared.readback.draft.html_body, htmlWith("Source A"));
  assert.equal(prepared.render.revision, 1);
  assert.equal(
    prepared.source.visual_verification,
    "unverified_missing_reference",
  );

  const revised = await call(child, "fonte_revise_broadcast_html_file", {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: "source-file-correction-v2",
    source_file: correctedFile,
    reference_file: null,
    postal_address_literal: null,
    literal_fallbacks: {},
  });
  assert.equal(revised.outcome, "completed");
  assert.equal(revised.save.draft_id, draftId);
  assert.equal(revised.save.revision, 2);
  assert.equal(revised.readback.draft.html_body, htmlWith("Source B"));
  assert.equal(revised.render.revision, 2);
  assert.equal(child.stderr(), "");
  assertNoSecret(child.output());
});

test("fresh authenticated fonte-mcp exposes the bounded Broadcast chain", async (t) => {
  const child = await startMcp();
  t.after(() => child.close());
  const initialized = await child.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fonte-broadcast-test", version: "1.0.0" },
  });
  assert.equal(initialized.result.serverInfo.name, "fonte");
  assert.match(initialized.result.instructions, /Processing is not executable/);
  child.notify("notifications/initialized", {});

  const listed = await child.request("tools/list", {});
  assert.deepEqual(
    listed.result.tools.map(({ name }) => name),
    [...MCP_FONTE_ALLOWLIST.tools],
  );

  const workspaceList = await call(child, "fonte_list_workspaces", {});
  assert.equal(workspaceList.outcome, "completed");
  assert.deepEqual(workspaceList.workspaces, [
    {
      slug: workspace,
      name: "Fonte",
      role: "owner",
      available_environments: ["production"],
    },
  ]);

  const created = await call(child, "fonte_create_broadcast_draft", {
    workspace,
    draft_id: draftId,
    title: "Synthetic draft",
    subject: "Synthetic subject",
    preheader: "Synthetic preheader",
    active_source: "html",
    composer_body: null,
    html_body: html,
  });
  assert.equal(created.outcome, "completed");
  assert.equal(created.draft.draft.sender_profile_id, null);
  assert.equal(created.draft.draft.audience_kind, null);

  const exactDraft = await call(child, "fonte_read_broadcast_draft", {
    workspace,
    draft_id: draftId,
  });
  assert.equal(exactDraft.draft.draft_id, draftId);
  assert.equal(exactDraft.draft.draft.html_body, html);

  const revised = await call(child, "fonte_update_broadcast_draft", {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: "replace-html-v2",
    changes: { active_source: "html", html_body: html },
  });
  assert.equal(revised.outcome, "completed");
  assert.equal(revised.revision.draft.html_body, html);

  const senders = await call(child, "fonte_list_broadcast_senders", {
    workspace,
    match: "sender@example.test",
  });
  assert.equal(senders.outcome, "completed");
  assert.equal(senders.catalog.resolution.outcome, "selected");
  assert.equal(senders.catalog.resolution.sender_profile_id, senderId);

  const bound = await call(child, "fonte_update_broadcast_sender", {
    workspace,
    draft_id: draftId,
    base_revision: 2,
    operation_id: "bind-synthetic-sender-v1",
    sender_profile_id: senderId,
  });
  assert.equal(bound.outcome, "completed");
  assert.equal(bound.revision.revision, 3);
  assert.equal(bound.revision.draft.sender_profile_id, senderId);
  assert.equal(bound.revision.draft.html_body, html);

  const boundReadback = await call(child, "fonte_read_broadcast_draft", {
    workspace,
    draft_id: draftId,
  });
  assert.equal(boundReadback.draft.revision, 3);
  assert.equal(boundReadback.draft.draft.sender_profile_id, senderId);
  assert.equal(boundReadback.draft.draft.html_body, html);

  const rendered = await call(child, "fonte_render_broadcast_draft", {
    workspace,
    draft_id: draftId,
    revision: 3,
  });
  assert.equal(rendered.outcome, "completed");
  assert.equal(rendered.render.render_content_digest, digest);
  assert.doesNotMatch(rendered.render.sample_render.html, /\{\{\{/);

  const requested = await call(child, "fonte_request_broadcast_test", {
    workspace,
    draft_id: draftId,
    revision: 3,
    operation_id: operationId,
    render_proof: rendered.render.render_proof,
  });
  assert.equal(requested.outcome, "completed");
  assert.deepEqual(
    requested.test_request.render_proof,
    rendered.render.render_proof,
  );

  const read = await call(child, "fonte_read_broadcast_test", {
    workspace,
    draft_id: draftId,
    test_id: testId,
  });
  assert.equal(read.test_result.provider_outcome, "accepted");
  assert.equal(read.test_result.delivery_outcome, "delivered");
  assert.equal(read.test_result.inbox_confirmation, "unavailable");

  await verifyTargeting(child);
  const sent = await call(child, "fonte_send_broadcast_now", {
    workspace,
    draft_id: draftId,
    request_id: sendRequestId,
    expected_draft_version: 4,
  });
  assert.equal(sent.reason, "canonical_send_review_required");
  assert.equal(sent.core_effect, "none");
  await verifyLoggedOutSession(child, rendered.render.render_proof);
});

async function verifyLoggedOutSession(child, renderProof) {
  const loggedOut = await call(child, "fonte_render_broadcast_draft", {
    workspace,
    draft_id: draftId,
    revision: 4,
  });
  assert.equal(loggedOut.reason, "login_required");
  assert.equal(loggedOut.core_effect, "none");

  const loggedOutRevision = await call(child, "fonte_update_broadcast_draft", {
    workspace,
    draft_id: draftId,
    base_revision: 4,
    operation_id: "blocked-replace-html-v3",
    changes: { active_source: "html", html_body: html },
  });
  assert.equal(loggedOutRevision.reason, "login_required");
  assert.equal(loggedOutRevision.core_effect, "none");

  await verifyLoggedOutTargeting(child);

  const loggedOutTest = await call(child, "fonte_request_broadcast_test", {
    workspace,
    draft_id: draftId,
    revision: 4,
    operation_id: "blocked-test-composition-v2",
    render_proof: renderProof,
  });
  assert.equal(loggedOutTest.reason, "login_required");
  assert.equal(loggedOutTest.core_effect, "none");
  const loggedOutRead = await call(child, "fonte_read_broadcast_draft", {
    workspace,
    draft_id: draftId,
  });
  assert.equal(loggedOutRead.reason, "login_required");
  assert.equal(loggedOutRead.core_effect, "none");
  assert.equal(child.stderr(), "");
  assertNoSecret(child.output());
}

async function verifyTargeting(child) {
  const targeted = await call(child, "fonte_update_broadcast_targeting", {
    workspace,
    draft_id: draftId,
    base_revision: 3,
    operation_id: "target-everyone-except-v1",
    recipient_selection: {
      to: { kind: "everyone" },
      except: [{ kind: "system", systemId }],
    },
  });
  assert.equal(targeted.outcome, "completed", JSON.stringify(targeted));
  assert.equal(targeted.targeting.revision, 4);
  assert.deepEqual(targeted.targeting.recipient_selection, {
    to: { kind: "everyone" },
    except: [{ kind: "system", systemId }],
  });
  assert.equal(targeted.targeting.draft.html_body, html);
}

async function verifyLoggedOutTargeting(child) {
  const targeted = await call(child, "fonte_update_broadcast_targeting", {
    workspace,
    draft_id: draftId,
    base_revision: 4,
    operation_id: "blocked-target-v2",
    recipient_selection: { to: { kind: "everyone" }, except: [] },
  });
  assert.equal(targeted.reason, "login_required");
  assert.equal(targeted.core_effect, "none");
}

async function call(child, name, args) {
  const response = await child.request("tools/call", {
    name,
    arguments: args,
  });
  assert.equal(response.error, undefined);
  return response.result.structuredContent;
}

async function startMcp() {
  const process = spawn(
    globalThis.process.execPath,
    ["tests/fixtures/cli-mcp-broadcast-stdio.mjs"],
    {
      cwd: globalThis.process.cwd(),
      env: { ...globalThis.process.env, FONTE_NONINTERACTIVE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const lines = createInterface({ input: process.stdout });
  const pending = new Map();
  let id = 0;
  let stdout = "";
  let stderr = "";
  lines.on("line", (line) => {
    stdout += `${line}\n`;
    const message = JSON.parse(line);
    if ("id" in message) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    request(method, params) {
      id += 1;
      const requestId = id;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`timed out waiting for ${method}`)),
          30_000,
        );
        pending.set(requestId, (message) => {
          clearTimeout(timeout);
          resolve(message);
        });
        process.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method,
            params,
          })}\n`,
        );
      });
    },
    notify(method, params) {
      process.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    output: () => stdout,
    stderr: () => stderr,
    close() {
      lines.close();
      process.kill("SIGTERM");
    },
  };
}

function assertNoSecret(value) {
  assert.equal(value.includes("synthetic-stdio-broadcast-bearer"), false);
  assert.equal(value.includes("refreshToken"), false);
}

function htmlWith(copy) {
  return (
    '<!doctype html><html><body style="font-family:Arial,sans-serif">' +
    `<p>${copy} {{{contact.email}}}</p>` +
    '<a href="{{{unsubscribe_url}}}">Leave</a></body></html>'
  );
}
