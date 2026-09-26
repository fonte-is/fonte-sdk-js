import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBroadcastFileStore } from "../packages/cli/dist/broadcast-file-store.js";
import { createBroadcastBgToolHandlers } from "../packages/cli/dist/mcp-broadcast-bg-tools.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import {
  coreOrigin,
  scope,
  workspaceId,
  ready,
  processing,
  requestId,
  reviewRequest,
  saved,
  json,
} from "./fixtures/broadcast-bg1.mjs";

const omittedScope = { environment: scope.environment, draftId: scope.draftId };
const invocations = {
  review: { ...omittedScope, request: reviewRequest },
  recover: { ...omittedScope, request_id: requestId },
  read: { ...omittedScope, operation_uri: ready.operationUri, kind: "review" },
  send: { send_input: saved() },
};

test("BG MCP provider login failure is typed before any Core effect and retains the exact request key", async () => {
  const handlers = createBroadcastBgToolHandlers(async () => {
    throw new HostedTestBlockedError("login_required");
  });
  for (const [name, input] of Object.entries(invocations)) {
    const result = await handlers[name](input);
    assert.equal(result.reason, "login_required");
    assert.equal(result.core_effect, "none");
    assert.equal(result.operation, null);
    assert.equal(result.request_id, name === "read" ? null : requestId);
    assert.equal(result.outcome, "unavailable");
  }
});

for (const explicit of [false, true]) {
  test(`BG MCP ${explicit ? "explicit" : "selected"} workspace applies to prepare, exact recovery and returned-URI observation`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "fon813-selection-"));
    try {
      const store = createBroadcastFileStore(directory);
      let selections = 0;
      const calls = [];
      const handlers = createBroadcastBgToolHandlers(async () => ({
        coreApiBaseUrl: coreOrigin,
        bearer: "synthetic-bg1-bearer",
        store,
        sleep: async () => {},
        readSelectedWorkspace: async () => {
          selections += 1;
          return explicit ? "a-different-selected-workspace" : scope.workspace;
        },
        resolveWorkspaceId: async (workspace) => {
          assert.equal(workspace, scope.workspace);
          return workspaceId;
        },
        fetch: async (url, init) => {
          calls.push({
            url: String(url),
            method: init.method,
            body: init.body,
          });
          if (init.body) {
            const body = JSON.parse(init.body);
            assert.deepEqual((await store.read(body.requestId)).request, body);
          }
          return json(
            init.body &&
              JSON.parse(init.body).schema === "broadcast_send_request.v2"
              ? processing
              : ready,
          );
        },
      }));
      for (const name of ["review", "recover", "read"]) {
        const input = {
          ...invocations[name],
          ...(explicit ? { workspace: scope.workspace } : {}),
        };
        const result = await handlers[name](input);
        assert.equal(result.operation?.operationId, ready.operationId);
        assert.equal(result.operation?.executionAuthorized, false);
      }
      assert.equal(selections, explicit ? 0 : 3);
      assert.equal(calls.length, 3);
      assert.deepEqual(
        calls.map(({ method }) => method),
        ["POST", "POST", "GET"],
      );
      assert.equal(
        new URL(calls[0].url).pathname,
        `/v1/workspaces/${scope.workspace}/broadcast-drafts/${scope.draftId}/broadcast-review`,
      );
      assert.deepEqual(JSON.parse(calls[0].body), reviewRequest);
      assert.deepEqual(JSON.parse(calls[1].body), reviewRequest);

      // An approved Send always uses its own exact saved scope, irrespective of selection.
      const sendStore = createBroadcastFileStore(join(directory, "send"));
      const sendHandlers = createBroadcastBgToolHandlers(async () => ({
        coreApiBaseUrl: coreOrigin,
        bearer: "synthetic-bg1-bearer",
        store: sendStore,
        sleep: async () => {},
        readSelectedWorkspace: async () => {
          throw new Error("Send cannot select a workspace");
        },
        resolveWorkspaceId: async (workspace) => {
          assert.equal(workspace, scope.workspace);
          return workspaceId;
        },
        fetch: async () => json(processing),
      }));
      assert.equal(
        (await sendHandlers.send(invocations.send)).operation?.operationId,
        processing.operationId,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("BG MCP missing or invalid selected workspace blocks with zero catalog, store or transport work", async () => {
  for (const selected of [undefined, null, ""]) {
    let catalog = 0;
    let fetches = 0;
    let storeReads = 0;
    const handlers = createBroadcastBgToolHandlers(async () => ({
      coreApiBaseUrl: coreOrigin,
      bearer: "synthetic-bg1-bearer",
      store: {
        read: async () => {
          storeReads += 1;
          throw new Error("must not read");
        },
      },
      sleep: async () => {},
      ...(selected === undefined
        ? {}
        : { readSelectedWorkspace: async () => selected }),
      resolveWorkspaceId: async () => {
        catalog += 1;
        return workspaceId;
      },
      fetch: async () => {
        fetches += 1;
        return json(ready);
      },
    }));
    for (const name of ["review", "recover", "read"]) {
      const result = await handlers[name](invocations[name]);
      assert.equal(result.reason, "workspace_selection_required");
      assert.equal(result.core_effect, "none");
      assert.equal(result.operation, null);
      assert.equal(result.request_id, name === "read" ? null : requestId);
    }
    assert.deepEqual(
      { catalog, fetches, storeReads },
      { catalog: 0, fetches: 0, storeReads: 0 },
    );
  }
});
