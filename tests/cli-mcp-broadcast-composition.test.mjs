import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";

import {
  MCP_FONTE_ALLOWLIST,
} from "../packages/cli/dist/mcp-sequence-server.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000151";
const testId = "00000000-0000-4000-8000-000000000152";
const operationId = "synthetic-test-composition-v2";
const digest = `sha256:${"c".repeat(64)}`;
const html = "<!doctype html><p>Hello {{{contact.email}}}</p>"
  + '<a href="{{{unsubscribe_url}}}">Leave</a>';

test("fresh authenticated fonte-mcp exposes the bounded Broadcast chain", async (t) => {
  const child = await startMcp();
  t.after(() => child.close());
  const initialized = await child.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fonte-broadcast-test", version: "1.0.0" },
  });
  assert.equal(initialized.result.serverInfo.name, "fonte");
  assert.match(initialized.result.instructions, /verified-account test/);
  child.notify("notifications/initialized", {});

  const listed = await child.request("tools/list", {});
  assert.deepEqual(
    listed.result.tools.map(({ name }) => name),
    [...MCP_FONTE_ALLOWLIST.tools],
  );

  const revised = await call(child, "fonte_update_broadcast_draft", {
    workspace,
    draft_id: draftId,
    base_revision: 1,
    operation_id: "replace-html-v2",
    changes: { active_source: "html", html_body: html },
  });
  assert.equal(revised.outcome, "completed");
  assert.equal(revised.revision.draft.html_body, html);

  const rendered = await call(child, "fonte_render_broadcast_draft", {
    workspace,
    draft_id: draftId,
    revision: 2,
  });
  assert.equal(rendered.outcome, "completed");
  assert.equal(rendered.render.render_content_digest, digest);
  assert.doesNotMatch(rendered.render.sample_render.html, /\{\{\{/);

  const requested = await call(child, "fonte_request_broadcast_test", {
    workspace,
    draft_id: draftId,
    revision: 2,
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

  const loggedOut = await call(child, "fonte_render_broadcast_draft", {
    workspace,
    draft_id: draftId,
    revision: 2,
  });
  assert.equal(loggedOut.reason, "login_required");
  assert.equal(loggedOut.core_effect, "none");

  const loggedOutRevision = await call(
    child,
    "fonte_update_broadcast_draft",
    {
      workspace,
      draft_id: draftId,
      base_revision: 2,
      operation_id: "blocked-replace-html-v3",
      changes: { active_source: "html", html_body: html },
    },
  );
  assert.equal(loggedOutRevision.reason, "login_required");
  assert.equal(loggedOutRevision.core_effect, "none");

  const loggedOutTest = await call(child, "fonte_request_broadcast_test", {
    workspace,
    draft_id: draftId,
    revision: 2,
    operation_id: "blocked-test-composition-v2",
    render_proof: rendered.render.render_proof,
  });
  assert.equal(loggedOutTest.reason, "login_required");
  assert.equal(loggedOutTest.core_effect, "none");
  assert.equal(child.stderr(), "");
  assertNoSecret(child.output());
});

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
  process.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    request(method, params) {
      id += 1;
      const requestId = id;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`timed out waiting for ${method}`)),
          5_000,
        );
        pending.set(requestId, (message) => {
          clearTimeout(timeout);
          resolve(message);
        });
        process.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method,
          params,
        })}\n`);
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
