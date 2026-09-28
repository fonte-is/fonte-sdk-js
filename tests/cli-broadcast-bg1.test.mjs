import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBroadcastClient,
  waitForBroadcastOperation,
} from "../packages/cli/dist/broadcast-client.js";
import { createBroadcastFileStore } from "../packages/cli/dist/broadcast-file-store.js";
import {
  parseBroadcastReviewReceipt,
  parseBroadcastSendReceipt,
  parseBroadcastSendStatus,
} from "../packages/cli/dist/broadcast-receipts.js";
import {
  parseBroadcastArguments,
  renderBroadcastCommand,
} from "../packages/cli/dist/broadcast-command.js";
import {
  coreOrigin,
  scope,
  workspaceId,
  review,
  ready,
  zeroReady,
  processing,
  executable,
  requestId,
  operationId,
  reviewRequest,
  sendRequest,
  saved,
  json,
} from "./fixtures/broadcast-bg1.mjs";

const resolved = { ...scope, workspaceId };
const secondId = "00000000-0000-4000-8000-000000008073";
const thirdId = "00000000-0000-4000-8000-000000008074";
const dependencies = (store) => ({
  coreApiBaseUrl: coreOrigin,
  bearer: "synthetic-bg1-bearer",
  store,
  resolveWorkspaceId: async () => workspaceId,
});

test("fixed FON-807 compact receipts preserve execution authority and immutable workspace identity", () => {
  assert.notEqual(scope.workspace, workspaceId);
  assert.deepEqual(
    parseBroadcastReviewReceipt(ready, coreOrigin, resolved, "none", 1),
    ready,
  );
  for (const outcome of ["processing", "action_required", "rejected"]) {
    const value = { ...processing, outcome };
    assert.deepEqual(
      parseBroadcastSendReceipt(value, coreOrigin, "none", resolved),
      value,
    );
    assert.throws(() =>
      parseBroadcastSendReceipt(
        { ...value, executionAuthorized: true },
        coreOrigin,
      ),
    );
    assert.throws(() =>
      parseBroadcastSendReceipt({ ...value, jobId: "job" }, coreOrigin),
    );
    const text = renderBroadcastCommand(
      {
        outcome: "observed",
        reason: `broadcast_send_${outcome}`,
        request_id: requestId,
        operation: value,
      },
      false,
    );
    assert.doesNotMatch(text, /Sending|completed/u);
    assert.match(text, new RegExp(operationId));
  }
  assert.deepEqual(
    parseBroadcastSendReceipt(executable, coreOrigin),
    executable,
  );
  assert.throws(() =>
    parseBroadcastSendStatus(
      { ...processing, execution: { state: "completed" } },
      coreOrigin,
    ),
  );
  for (const bad of [
    { ...ready, review: { ...review, workspaceId: "foreign" } },
    { ...ready, review: { ...review, draftVersion: 2 } },
    { ...ready, assignments: [] },
  ]) {
    assert.throws(() =>
      parseBroadcastReviewReceipt(bad, coreOrigin, resolved, "none", 1),
    );
  }
  assert.throws(() =>
    parseBroadcastSendReceipt(
      { ...processing, blocker: { code: "unknown" } },
      coreOrigin,
    ),
  );
});

test("canonical saved input rejects legacy arrays and same-key changes before any POST", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fon813-store-"));
  try {
    const store = createBroadcastFileStore(directory);
    let calls = 0;
    const client = createBroadcastClient({
      ...dependencies(store),
      fetch: async (_url, init) => {
        calls++;
        assert.deepEqual(
          (await store.read(requestId)).request,
          JSON.parse(init.body),
        );
        return json(processing);
      },
    });
    await client.send(scope, sendRequest);
    await assert.rejects(
      client.send(scope, {
        ...sendRequest,
        reviewDigest: `sha256:${"b".repeat(64)}`,
      }),
      /broadcast_request_conflict/u,
    );
    assert.equal(calls, 1);
    const text = await readFile(join(directory, `${requestId}.json`), "utf8");
    assert.doesNotMatch(
      text,
      /synthetic-bg1-bearer|recipientIds|assignments|commercialGrant/u,
    );
    await writeFile(
      join(directory, `${secondId}.json`),
      JSON.stringify({ requestId: secondId, assignments: ["legacy"] }),
    );
    await assert.rejects(
      client.recover(secondId),
      /broadcast_saved_input_recover_review_required/u,
    );
    assert.equal(calls, 1);
    assert.throws(
      () =>
        parseBroadcastArguments([
          "broadcast",
          "send",
          "--send-input",
          '{"assignments":[]}',
        ]),
      /broadcast_saved_input_recover_review_required/u,
    );
    assert.equal(parseBroadcastArguments(["broadcast", "send", "now"]), null);
    assert.equal(
      parseBroadcastArguments(["broadcast", "send", "schedule"]),
      null,
    );
    const globalJson = parseBroadcastArguments([
      "--json",
      "broadcast",
      "send",
      "--send-input",
      JSON.stringify(saved()),
    ]);
    assert.equal(globalJson.kind, "broadcast_bg_send");
    assert.equal(globalJson.json, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("injected current-custody requester preserves explicit ceilings and rejects a different resumed operation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fon813-injected-"));
  try {
    const seen = [];
    const client = createBroadcastClient({
      coreApiBaseUrl: coreOrigin,
      store: createBroadcastFileStore(directory),
      requestTimeoutMs: 90_000,
      resolveWorkspaceId: async (workspace, ceiling) => {
        assert.equal(workspace, scope.workspace);
        assert.equal(ceiling, 90_000);
        return workspaceId;
      },
      request: async (path, options) => {
        seen.push({ path, options });
        return { ...executable, operationId: secondId };
      },
    });
    await assert.rejects(
      client.send(scope, {
        ...sendRequest,
        resume: { operationId, expectedOperationVersion: 1 },
      }),
      (error) =>
        error.reason === "core_operator_receipt_invalid" &&
        error.coreEffect === "unknown",
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].options.timeoutMs, 90_000);
    assert.deepEqual(seen[0].options.body.resume, {
      operationId,
      expectedOperationVersion: 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("one explicit request ceiling applies to review POST/read, Send POST/read and fresh recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fon813-timeout-"));
  const timeouts = new Map();
  const original = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    const signal = original(milliseconds);
    timeouts.set(signal, milliseconds);
    return signal;
  };
  try {
    const seen = [];
    const client = createBroadcastClient({
      ...dependencies(createBroadcastFileStore(directory)),
      requestTimeoutMs: 90_000,
      fetch: async (url, init) => {
        seen.push(timeouts.get(init.signal));
        const isReview =
          url.includes("broadcast-review") || url.endsWith("review-operation");
        return json(
          isReview
            ? ready
            : init.method === "GET"
              ? { ...processing, execution: null }
              : processing,
        );
      },
    });
    await client.review(scope, reviewRequest);
    await client.readReview(scope, `${coreOrigin}/review-operation`);
    await client.send(scope, { ...sendRequest, requestId: secondId });
    await client.readSend(scope, processing.operationUri);
    await client.recover(secondId);
    assert.deepEqual(seen, Array(5).fill(90_000));
    const defaults = [];
    const defaultClient = createBroadcastClient({
      ...dependencies(createBroadcastFileStore(directory)),
      fetch: async (_url, init) => {
        defaults.push(timeouts.get(init.signal));
        return json(processing);
      },
    });
    await defaultClient.send(scope, { ...sendRequest, requestId: thirdId });
    assert.deepEqual(defaults, [60_000]);
  } finally {
    AbortSignal.timeout = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("off-origin, oversized and stalled response bodies cannot transfer credentials or imply no effect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fon813-boundary-"));
  try {
    let calls = 0;
    const store = createBroadcastFileStore(directory);
    const client = createBroadcastClient({
      ...dependencies(store),
      fetch: async () => {
        calls++;
        return json(processing);
      },
    });
    for (const uri of [
      "https://evil.example.test/status",
      "//evil.example.test/status",
      "https://user@core.example.test/status",
      `${coreOrigin}/status#fragment`,
      "javascript:alert(1)",
    ]) {
      await assert.rejects(
        client.readSend(scope, uri),
        /core_operation_uri_invalid/u,
      );
    }
    assert.equal(calls, 0);
    const large = createBroadcastClient({
      ...dependencies(store),
      fetch: async () => json({ ...processing, extra: "x".repeat(65_536) }),
    });
    await assert.rejects(
      large.send(scope, sendRequest),
      (error) =>
        error.reason === "core_response_too_large" &&
        error.coreEffect === "unknown",
    );
    const badUri = createBroadcastClient({
      ...dependencies(store),
      fetch: async () =>
        json({
          ...processing,
          operationUri: "https://evil.example.test/status",
        }),
    });
    await assert.rejects(
      badUri.recover(requestId),
      (error) =>
        error.reason === "core_operator_receipt_invalid" &&
        error.coreEffect === "unknown",
    );
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const stalled = createBroadcastClient({
        ...dependencies(store),
        requestTimeoutMs: 10,
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"));
              },
            }),
          ),
      });
      await assert.rejects(
        stalled.recover(requestId),
        (error) =>
          error.reason === "core_api_unavailable" &&
          error.coreEffect === "unknown",
      );
    } finally {
      clearTimeout(keepAlive);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("foreground deadline returns pending with the same operation and performs only bounded GET polling", async () => {
  let now = 0;
  const reads = [];
  const result = await waitForBroadcastOperation(
    {
      readSend: async (_scope, uri, budget) => {
        reads.push({ uri, budget });
        return { ...processing, execution: null };
      },
    },
    scope,
    processing,
    {
      foregroundWaitMs: 5,
      pollIntervalMs: 2,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.equal(result.pending, true);
  assert.equal(result.receipt.operationId, operationId);
  assert.deepEqual(
    reads.map((read) => read.budget),
    [3, 1],
  );
});
