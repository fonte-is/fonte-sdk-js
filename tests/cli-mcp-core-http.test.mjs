import assert from "node:assert/strict";
import test from "node:test";
import { handleCoreMcpRequest, MCP_HOSTED_TOOLS } from "../packages/cli/dist/mcp-core-handler.js";

async function call(method, params, requester = async () => { throw Error("unexpected Core call"); }) {
  const response = await handleCoreMcpRequest(new Request("https://app.example.test/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), requester, "https://api.example.test");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("mcp-session-id"), null);
  return { status: response.status, value: await response.json() };
}
test("hosted HTTP has one exact registry, no local-file or legacy Send path", async () => {
  const initialized = await call("initialize", { protocolVersion: "2025-11-25", capabilities: {},
    clientInfo: { name: "synthetic-public-client", version: "1" } });
  assert.equal(initialized.status, 200);
  const { value } = await call("tools/list", {});
  const names = value.result.tools.map(tool => tool.name);
  assert.deepEqual(names.sort(), [...MCP_HOSTED_TOOLS].sort());
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("fonte_send_broadcast"));
  assert.ok(names.includes("fonte_read_broadcast_send_operation"));
  assert.ok(names.includes("fonte_read_broadcast_results"));
  assert.ok(!names.includes("fonte_send_broadcast_now"));
  assert.ok(!names.some(name => name.includes("html_file")));
});
test("concurrent HTTP requests use their own Core requester without session state", async () => {
  const requester = slug => async path => {
    assert.equal(path, "/v1/workspaces");
    return { workspaces: [{ workspaceId: `${slug}-workspace`, tenantId: `${slug}-workspace`, accountId: `${slug}-account`,
      slug, workspaceSlug: slug, workspaceCode: slug, displayName: slug, role: "owner", availableEnvironments: ["production"] }] };
  };
  const [a, b] = await Promise.all([call("tools/call", { name: "fonte_list_workspaces", arguments: {} }, requester("northstar")),
    call("tools/call", { name: "fonte_list_workspaces", arguments: {} }, requester("southstar"))]);
  assert.ok(JSON.stringify(a.value).includes("northstar"));
  assert.ok(!JSON.stringify(a.value).includes("southstar"));
  assert.ok(JSON.stringify(b.value).includes("southstar"));
  assert.ok(!JSON.stringify(b.value).includes("northstar"));
});
test("invalid remote input never reaches Core", async () => {
  let effects = 0;
  const { value } = await call("tools/call", { name: "fonte_create_broadcast_recipient_set", arguments: {
    workspace: "northstar", draft_id: "invalid", csv_text: "email\nrecipient@example.invalid\n", source_file_name: "/etc/passwd" } },
  async () => { effects++; });
  assert.equal(effects, 0);
  assert.ok(value.error || value.result.isError);
});
