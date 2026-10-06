import assert from "node:assert/strict";
import test from "node:test";
import { createBroadcastClient, waitForBroadcastOperation } from "../packages/cli/dist/broadcast-client.js";
import { parseBroadcastSendReceipt, parseBroadcastSendStatus } from "../packages/cli/dist/broadcast-receipts.js";
import { renderBroadcastCommand } from "../packages/cli/dist/broadcast-command.js";
import { handleCoreMcpRequest } from "../packages/cli/dist/mcp-core-handler.js";
import { coreOrigin, scope, workspaceId, receiptBase, sendRequest, saved } from "./fixtures/broadcast-bg1.mjs";

const resolved = { ...scope, workspaceId };
const handoff = {
  ...receiptBase, schema: "broadcast_send_receipt.v3", outcome: "processing",
  businessAccepted: true, controlGeneration: 1, executionState: "handoff_pending",
  executionAuthorized: false, jobId: null,
};
const unconfirmed = { ...handoff, executionState: "unconfirmed", executionAuthorized: null };
const ready = { ...handoff, executionState: "ready", executionAuthorized: true, jobId: "synthetic_job" };
const stopped = { ...ready, executionState: "stopped", executionAuthorized: false };

test("current Core receipts preserve acceptance separately from execution and delivery", () => {
  for (const receipt of [handoff, unconfirmed, ready, stopped,
    { ...stopped, jobId: null }, { ...handoff, businessAccepted: false },
    { ...handoff, jobId: "synthetic_job" }]) {
    assert.deepEqual(parseBroadcastSendReceipt(receipt, coreOrigin, "none", resolved), receipt);
    const status = parseBroadcastSendStatus(receipt, coreOrigin, resolved);
    assert.deepEqual(status, receipt);
    assert.equal("execution" in status, false);
  }
  const text = renderBroadcastCommand({ outcome: "observed", reason: "broadcast_send_stopped",
    request_id: sendRequest.requestId, operation: stopped }, false);
  assert.match(text, /Accepted; execution stopped/u);
  assert.doesNotMatch(text, /delivered|completed|Sending/u);
});

test("invalid isolated authority, unknown schema and unbound receipts fail closed", () => {
  for (const receipt of [
    { ...ready, businessAccepted: false }, { ...ready, jobId: null },
    { ...ready, executionAuthorized: false }, { ...unconfirmed, executionAuthorized: false },
    { ...unconfirmed, jobId: "synthetic_job" }, { ...unconfirmed, businessAccepted: false },
    { ...stopped, executionAuthorized: true }, { ...stopped, businessAccepted: false },
    { ...handoff, executionAuthorized: true }, { ...handoff, businessAccepted: false, jobId: "synthetic_job" },
    { ...handoff, controlGeneration: -1 }, { ...handoff, controlGeneration: 1.5 },
    { ...handoff, schema: "broadcast_send_receipt.v4" }, { ...handoff, execution: null },
    { ...handoff, draftId: "foreign_draft" },
    { ...handoff, operationUri: "https://foreign.example.test/v1/workspaces/other/broadcast-send-operations/id" },
  ]) assert.throws(() => parseBroadcastSendReceipt(receipt, coreOrigin, "none", resolved),
    error => error.reason === "core_operator_receipt_invalid");
});

test("caller custody recovers a lost current receipt with exactly the same Send command", async () => {
  const posts = [];
  const client = createBroadcastClient({ coreApiBaseUrl: coreOrigin, requestCustody: "caller",
    resolveWorkspaceId: async () => workspaceId,
    request: async (path, options) => {
      posts.push({ path, body: options.body });
      if (posts.length === 1) throw new Error("synthetic response lost after Core acceptance");
      return stopped;
    } });
  await assert.rejects(client.send(scope, sendRequest), /synthetic response lost/u);
  assert.deepEqual(await client.send(scope, sendRequest), stopped);
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.requestId, sendRequest.requestId);
});

test("accepted v3 receipts must match the approved review and resumed operation", async () => {
  for (const receipt of [ { ...handoff, reviewId: "foreign_review" },
    { ...stopped, operationId: "00000000-0000-4000-8000-000000008079" } ]) {
    const client = createBroadcastClient({ coreApiBaseUrl: coreOrigin, requestCustody: "caller",
      resolveWorkspaceId: async () => workspaceId, request: async () => receipt });
    await assert.rejects(client.send(scope, { ...sendRequest,
      resume: { operationId: receiptBase.operationId, expectedOperationVersion: 1 } }),
    error => error.reason === "core_operator_receipt_invalid");
  }
});

test("v3 foreground observation waits for handoff confirmation using only reads", async () => {
  for (const terminal of [ready, stopped]) {
    let now = 0;
    const reads = [];
    const receipts = [unconfirmed, terminal];
    const result = await waitForBroadcastOperation({ readSend: async (_scope, uri, budget) => {
      reads.push({ uri, budget }); return receipts.shift();
    } }, scope, handoff, { foregroundWaitMs: 100, pollIntervalMs: 10,
      now: () => now, sleep: async delay => { now += delay; } });
    assert.equal(result.pending, false);
    assert.deepEqual(result.receipt, terminal);
    assert.equal(reads.length, 2);
    assert.ok(reads.every(read => read.uri === receiptBase.operationUri && read.budget > 0));
  }
  const result = await waitForBroadcastOperation({}, scope, unconfirmed,
    { foregroundWaitMs: 0, sleep: async () => { throw Error("unexpected wait"); } });
  assert.equal(result.pending, true);
  assert.deepEqual(result.receipt, unconfirmed);
});

test("public HTTP MCP exposes the current receipt without an ambiguous Send error", async () => {
  const posts = [];
  const response = await handleCoreMcpRequest(new Request("https://app.example.test/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "fonte_send_broadcast", arguments: { send_input: saved(), wait_ms: 0 } } }),
  }), async (path, options) => {
    if (path === "/v1/workspaces") return { workspaces: [{ workspaceId, tenantId: workspaceId,
      accountId: "synthetic_account", slug: scope.workspace, workspaceSlug: scope.workspace,
      workspaceCode: scope.workspace, displayName: scope.workspace, role: "owner", availableEnvironments: ["sandbox"] }] };
    posts.push({ path, body: options.body }); return stopped;
  }, coreOrigin);
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.result.isError, undefined);
  assert.equal(value.result.structuredContent.outcome, "observed");
  assert.equal(value.result.structuredContent.reason, "broadcast_send_stopped");
  assert.deepEqual(value.result.structuredContent.operation, stopped);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, sendRequest);
});
