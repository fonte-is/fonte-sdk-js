import assert from "node:assert/strict";
import test from "node:test";

import { reconcileCodexMcpConfig } from "../packages/cli/dist/codex-mcp-config.js";

const host = {
  command: "/runtime/node",
  args: ["/package/dist/mcp-main.js"],
};

test("empty Codex MCP config plans one canonical local Fonte entry", () => {
  const plan = reconcileCodexMcpConfig("", host);

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.removedServers, []);
  assert.equal(
    plan.text,
    '[mcp_servers.fonte]\ncommand = "/runtime/node"\nargs = ["/package/dist/mcp-main.js"]\n',
  );
});

test("replaces stale Fonte entries and preserves unrelated Codex servers", () => {
  const source = [
    'model = "example"',
    "",
    "[mcp_servers.unrelated]",
    'command = "unrelated-host"',
    "",
    "[mcp_servers.fonte]",
    'url = "https://example.test/mcp"',
    "",
    "[mcp_servers.fonte-local]",
    'command = "stale-local-host"',
    "",
    "[features]",
    "experimental = true",
    "",
  ].join("\n");

  const plan = reconcileCodexMcpConfig(source, host);

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.removedServers.sort(), ["fonte", "fonte-local"]);
  assert.match(
    plan.text,
    /\[mcp_servers\.unrelated\][\s\S]*command = "unrelated-host"/,
  );
  assert.match(plan.text, /\[features\][\s\S]*experimental = true/);
  assert.doesNotMatch(
    plan.text,
    /https:\/\/example\.test\/mcp|stale-local-host/,
  );
  assert.equal((plan.text.match(/\[mcp_servers\.fonte\]/g) ?? []).length, 1);
  assert.doesNotMatch(plan.text, /\[mcp_servers\.fonte-local\]/);
});

test("an already-canonical Fonte entry is a byte-for-byte no-op", () => {
  const first = reconcileCodexMcpConfig("", host);
  const second = reconcileCodexMcpConfig(first.text, host);

  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
  assert.deepEqual(second.removedServers, []);
});

test("table-looking multiline text is preserved as unrelated content", () => {
  const source = [
    "notice = '''",
    "[mcp_servers.fonte]",
    "not a table header inside a string",
    "'''",
    "",
    "[mcp_servers.other]",
    'command = "other"',
    "",
  ].join("\n");
  const plan = reconcileCodexMcpConfig(source, host);

  assert.match(
    plan.text,
    /notice = '''\n\[mcp_servers\.fonte\]\nnot a table header inside a string\n'''/,
  );
  assert.match(plan.text, /\[mcp_servers\.other\][\s\S]*command = "other"/);
  assert.equal((plan.text.match(/^\[mcp_servers\.fonte\]$/gm) ?? []).length, 2);
});

test("removes only a stale inline Fonte entry in the root MCP table", () => {
  const source = [
    "[mcp_servers]",
    'unrelated = { command = "other" }',
    'fonte = { url = "https://example.test/mcp" }',
    "",
    "[features]",
    "experimental = true",
    "",
  ].join("\n");
  const plan = reconcileCodexMcpConfig(source, host);

  assert.match(plan.text, /unrelated = \{ command = "other" \}/);
  assert.match(plan.text, /\[features\][\s\S]*experimental = true/);
  assert.doesNotMatch(plan.text, /https:\/\/example\.test\/mcp/);
  assert.match(plan.text, /\[mcp_servers\.fonte\]/);
});

test("rejects a non-inline root Fonte entry instead of guessing at its extent", () => {
  assert.throws(
    () => reconcileCodexMcpConfig('[mcp_servers]\nfonte = "unknown"\n', host),
    /codex_mcp_config_unsupported_fonte_entry/,
  );
});
