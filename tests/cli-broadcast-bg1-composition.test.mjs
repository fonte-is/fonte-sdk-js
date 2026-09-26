import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createAuthenticatedBroadcastProvider } from "../packages/cli/dist/broadcast-runtime.js";
import { createBroadcastFileStore } from "../packages/cli/dist/broadcast-file-store.js";
import { createBroadcastClient } from "../packages/cli/dist/broadcast-client.js";
import {
  createWorkspaceCatalogClient,
  resolveAuthorizedWorkspaceId,
} from "../packages/cli/dist/operator-workspace-catalog-client.js";
import { MCP_FONTE_TOOLS } from "../packages/cli/dist/mcp-sequence-server.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  coreOrigin,
  scope,
  workspaceId,
  requestId,
  reviewRequest,
  ready,
  processing,
  saved,
  json,
} from "./fixtures/broadcast-bg1.mjs";

const catalogEntry = {
  workspaceId,
  tenantId: "tenant_bg1",
  accountId: "account_bg1",
  slug: "bg1-slug",
  workspaceSlug: "bg1-slug",
  workspaceCode: scope.workspace,
  displayName: "Synthetic BG-1",
  role: "owner",
  availableEnvironments: ["sandbox"],
};
const catalog = { workspaces: [catalogEntry] };
const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: coreOrigin,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("authenticated catalog resolves code to immutable ID without changing public summaries", async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    return catalog;
  };
  assert.equal(
    await resolveAuthorizedWorkspaceId(request, scope.workspace, 90_000),
    workspaceId,
  );
  assert.deepEqual(calls[0], {
    path: "/v1/workspaces",
    options: { timeoutMs: 90_000 },
  });
  assert.deepEqual(
    await createWorkspaceCatalogClient(request).listWorkspaces(),
    [
      {
        slug: "bg1-slug",
        name: "Synthetic BG-1",
        role: "owner",
        available_environments: ["sandbox"],
      },
    ],
  );
  await assert.rejects(
    resolveAuthorizedWorkspaceId(request, "foreign"),
    /broadcast_workspace_unavailable/u,
  );
  await assert.rejects(
    resolveAuthorizedWorkspaceId(
      async () => ({
        workspaces: [
          catalogEntry,
          {
            ...catalogEntry,
            workspaceId: "other",
            slug: "other-slug",
            workspaceSlug: "other-slug",
          },
        ],
      }),
      scope.workspace,
    ),
    /broadcast_workspace_unavailable/u,
  );
});

test("current-custody BG requester refreshes only proven no-effect 401 and keeps control responses bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fon813-auth-"));
  const ceilings = new Map();
  const original = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    const signal = original(milliseconds);
    ceilings.set(signal, milliseconds);
    return signal;
  };
  try {
    let authorizations = 0,
      refreshes = 0,
      catalogCalls = 0,
      mutations = 0;
    const provider = createAuthenticatedBroadcastProvider({
      configUrl,
      store: createBroadcastFileStore(directory),
      authorize: async () => {
        authorizations++;
        return "synthetic-before";
      },
      renewAuthorization: async () => {
        refreshes++;
        return "synthetic-after";
      },
      fetch: async (input, init) => {
        if (String(input) === configUrl) return json(hosted);
        assert.equal(ceilings.get(init.signal), 90_000);
        assert.equal(init.redirect, "error");
        const url = new URL(String(input));
        if (url.pathname === "/v1/workspaces") {
          if (++catalogCalls === 1)
            return json({ error: "human_auth_invalid" }, 401);
          return json(catalog);
        }
        mutations++;
        assert.equal(init.headers.authorization, "Bearer synthetic-after");
        return json({ ...processing, unexpected: "x".repeat(65_536) });
      },
    });
    const client = createBroadcastClient({
      ...(await provider()),
      requestTimeoutMs: 90_000,
    });
    await assert.rejects(
      client.send(scope, saved().request),
      (error) =>
        error.reason === "core_response_too_large" &&
        error.coreEffect === "unknown",
    );
    assert.equal(authorizations, 1);
    assert.equal(refreshes, 1);
    assert.equal(mutations, 1);
  } finally {
    AbortSignal.timeout = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual program help describes exact review, recovery and read-only observation", async () => {
  for (const [command, text] of [
    [["broadcast", "review"], /refresh is explicit/u],
    [["broadcast", "send"], /Processing is not executable/u],
    [["broadcast", "send", "recover"], /exact durably saved request/u],
  ]) {
    const result = await runProgram([...command, "--help"], {
      cwd: process.cwd(),
      randomUUID: () => assert.fail(),
      runner: { run: () => assert.fail() },
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, text);
  }
});

test("actual MCP server registers one normal path, preserves historical controls and uses BG receipts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fon813-mcp-composition-"));
  const child = spawn(
    process.execPath,
    ["tests/fixtures/broadcast-bg1-mcp-composition.mjs", directory],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines = createInterface({ input: child.stdout });
  let id = 0,
    stderr = "";
  const pending = new Map();
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    const resolve = pending.get(value.id);
    if (resolve) {
      pending.delete(value.id);
      resolve(value);
    }
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`MCP ${method}: ${stderr}`));
      }, 15_000);
      pending.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });
  t.after(async () => {
    lines.close();
    child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  });
  const initialized = await call("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "bg1-composition", version: "1" },
  });
  assert.match(
    initialized.result.instructions,
    /Processing is not executable/u,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const listed = await call("tools/list", {});
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [...MCP_FONTE_TOOLS]);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("fonte_read_legacy_broadcast_send_operation"));
  const prepared = await call("tools/call", {
    name: "fonte_prepare_broadcast",
    arguments: { ...scope, request: reviewRequest },
  });
  assert.deepEqual(prepared.result.structuredContent.operation, ready);
  const sent = await call("tools/call", {
    name: "fonte_send_broadcast",
    arguments: { send_input: saved() },
  });
  // Review and Send cannot share a request key with different canonical input.
  assert.equal(
    sent.result.structuredContent.reason,
    "broadcast_request_conflict",
  );
  const accepted = await call("tools/call", {
    name: "fonte_send_broadcast",
    arguments: {
      send_input: saved({
        ...saved().request,
        requestId: "00000000-0000-4000-8000-000000008076",
      }),
    },
  });
  assert.deepEqual(accepted.result.structuredContent.operation, processing);
  assert.equal(accepted.result.structuredContent.outcome, "pending");
  const retired = await call("tools/call", {
    name: "fonte_send_broadcast_now",
    arguments: {
      workspace: scope.workspace,
      draft_id: "00000000-0000-4000-8000-000000008079",
      expected_draft_version: 1,
      request_id: requestId,
    },
  });
  assert.equal(
    retired.result.structuredContent.reason,
    "canonical_send_review_required",
  );
  assert.equal(stderr, "");
});
