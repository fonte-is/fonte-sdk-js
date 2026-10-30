import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import test from "node:test";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createDurableFonteMcpSession, createFonteMcpServer, MCP_FONTE_TOOLS } from "../packages/cli/dist/mcp-sequence-server.js";
import { MCP_HOSTED_TOOLS } from "../packages/cli/dist/mcp-core-server.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";

const scope = { workspace: "northstar", draft_id: "99999999-9999-4999-8999-999999999999" };
const command = { ...scope, command_id: "88888888-8888-4888-8888-888888888888", expected_generation: 7 };
const controlPath = `/v1/workspaces/${scope.workspace}/broadcast-drafts/${scope.draft_id}/send-intent`;

async function local(t) {
  const proof = { authorizations: 0, configurationReads: 0, requests: [], commits: 0, mode: "ready", lost: false };
  const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
  const receipt = { status: "accepted", operation: { schema: "broadcast_send_control_receipt.v2", operationId: "77777777-7777-4777-8777-777777777777",
    commandId: command.command_id, generation: 8, effect: "effective", executionState: "stopped" } };
  const session = createDurableFonteMcpSession({ configUrl,
    authorize: async () => {
      proof.authorizations++;
      if (proof.mode === "signed_out") throw new HostedTestBlockedError("login_required");
      return `synthetic-control-session-${proof.authorizations}`;
    },
    fetch: async (input, options = {}) => {
      if (String(input) === configUrl) {
        proof.configurationReads++;
        return Response.json({ schema: "fonte.cli.hosted_config.v1", authorizationServer: "https://identity.example.test/auth/v1",
          clientId: "fonte-cli-client-v0", coreApiBaseUrl: "https://api.example.test", redirectUri: "http://127.0.0.1:49671/callback", scopes: ["email"] });
      }
      const url = new URL(input), body = options.body ? JSON.parse(options.body) : null;
      const bearer = new Headers(options.headers).get("Authorization");
      assert.equal(bearer, `Bearer synthetic-control-session-${proof.authorizations}`);
      assert.equal(url.origin, "https://api.example.test");
      assert.equal(url.search, "?environment=production");
      proof.requests.push({ path: url.pathname, body, bearer, method: options.method });
      if (proof.mode === "denied" || url.pathname.includes("/foreign/")) return Response.json({ error: "human_auth_workspace_access_denied" }, { status: 403 });
      if (proof.mode === "conflict") return Response.json({ error: "broadcast_send_control_conflict" }, { status: 409 });
      if (url.pathname === controlPath) {
        assert.equal(body, null);
        return Response.json({ status: "accepted", operation: { schema: "broadcast_send_receipt.v3", controlGeneration: 7 } });
      }
      assert.equal(url.pathname, `${controlPath}/control`);
      assert.deepEqual(body, { commandId: command.command_id, expectedGeneration: 7, action: "cancel" });
      if (proof.commits === 0) proof.commits++;
      if (proof.mode === "lost_reply" && !proof.lost) { proof.lost = true; throw TypeError("synthetic response loss after commit"); }
      return Response.json(receipt);
    },
  });
  const server = createFonteMcpServer(session, {
    inspectHost: async () => ({ initialized: true, tools: MCP_FONTE_TOOLS }),
    readSession: async () => ({ status: { state: "ready", serverCheck: "not_checked" }, storageAvailable: true }),
    listWorkspaces: async () => [{ slug: scope.workspace, name: "Synthetic workspace" }],
    readSelectedWorkspace: async () => scope.workspace,
  });
  const input = new PassThrough(), output = new PassThrough(), lines = createInterface({ input: output }), pending = new Map();
  let id = 0;
  lines.on("line", line => { const message = JSON.parse(line); pending.get(message.id)?.(message); pending.delete(message.id); });
  t.after(async () => { await server.close(); input.destroy(); output.destroy(); lines.close(); });
  await server.connect(new StdioServerTransport(input, output, { maxBufferSize: 1_048_576 }));
  const request = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Timed out: ${method}`)); }, 5000);
    pending.set(requestId, value => { clearTimeout(timer); resolve(value); });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "control-regression", version: "1" } });
  input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  return { proof, receipt, request, call: async (name, args) => (await request("tools/call", { name, arguments: args })).result };
}

test("fresh local discovery includes current controls without authorization or Core reads", async t => {
  const h = await local(t), response = await h.request("tools/list", {}), tools = response.result.tools;
  const names = tools.map(tool => tool.name);
  assert.deepEqual(names, [...MCP_FONTE_TOOLS]);
  assert.equal(names.length, 91); assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("fonte_cancel_broadcast_send"), "historical cancellation disappeared");
  for (const name of ["fonte_read_broadcast_control", "fonte_cancel_broadcast"]) {
    assert.ok(names.includes(name));
    assert.equal(MCP_HOSTED_TOOLS.filter(candidate => candidate === name).length, 1);
    const annotations = tools.find(tool => tool.name === name).annotations;
    assert.equal(annotations.readOnlyHint, name === "fonte_read_broadcast_control");
    assert.equal(annotations.idempotentHint, true);
    assert.equal(annotations.destructiveHint, false);
  }
  assert.equal(new Set(MCP_HOSTED_TOOLS).size, MCP_HOSTED_TOOLS.length);
  assert.equal(h.proof.authorizations, 0); assert.equal(h.proof.configurationReads, 0); assert.deepEqual(h.proof.requests, []);
});

test("local controls retain current custody, exact generation and lost-reply identity", async t => {
  const h = await local(t);
  const observed = await h.call("fonte_read_broadcast_control", scope);
  assert.equal(observed.structuredContent.receipt.operation.controlGeneration, command.expected_generation);
  assert.deepEqual(h.proof.requests[0], { path: controlPath, body: null, method: "GET", bearer: "Bearer synthetic-control-session-1" });
  h.proof.mode = "lost_reply";
  const lost = await h.call("fonte_cancel_broadcast", command);
  assert.equal(lost.isError, true); assert.equal(lost.structuredContent.outcome, "ambiguous");
  assert.equal(lost.structuredContent.core_effect, "unknown");
  assert.equal(h.proof.requests.length, 2, "lost cancel automatically retried");
  const replay = await h.call("fonte_cancel_broadcast", command);
  assert.equal(replay.structuredContent.outcome, "completed");
  assert.deepEqual(replay.structuredContent.receipt, h.receipt);
  assert.equal(h.proof.commits, 1); assert.equal(h.proof.authorizations, 3);
  assert.deepEqual(h.proof.requests[1].body, h.proof.requests[2].body);
  assert.notEqual(h.proof.requests[1].bearer, h.proof.requests[2].bearer);
  assert.equal(h.proof.requests[1].method, "POST");
  const previous = h.proof.requests.length;
  h.proof.mode = "signed_out";
  const denied = await h.call("fonte_cancel_broadcast", command);
  assert.equal(denied.structuredContent.reason, "login_required"); assert.equal(h.proof.requests.length, previous);
});

test("invalid controls never authenticate; access and generation failures stay authoritative", async t => {
  const h = await local(t);
  for (const invalid of [{ ...command, expected_generation: -1 }, { ...command, expected_generation: 0.5 },
    { ...command, expected_generation: Number.MAX_SAFE_INTEGER }, { ...command, command_id: "invalid" },
    { ...command, action: "resume" }, { ...command, environment: "sandbox" },
    { ...command, expected_instruction_generation: 7 }]) {
    const result = await h.request("tools/call", { name: "fonte_cancel_broadcast", arguments: invalid });
    assert.ok(result.error || result.result?.isError);
  }
  assert.equal(h.proof.authorizations, 0); assert.equal(h.proof.configurationReads, 0);
  for (const [mode, outcome] of [["denied", "denied"], ["conflict", "conflict"]]) {
    h.proof.mode = mode;
    const result = await h.call("fonte_cancel_broadcast", command);
    assert.equal(result.isError, true); assert.equal(result.structuredContent.outcome, outcome);
    assert.equal(result.structuredContent.core_effect, "none");
  }
  h.proof.mode = "ready";
  const foreign = await h.call("fonte_cancel_broadcast", { ...command, workspace: "foreign" });
  assert.equal(foreign.structuredContent.outcome, "denied");
  assert.ok(h.proof.requests.at(-1).path.startsWith("/v1/workspaces/foreign/"));
  assert.equal(h.proof.commits, 0); assert.equal(h.proof.requests.length, 3);
});
