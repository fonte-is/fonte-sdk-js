import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { MCP_FONTE_TOOLS } from "../packages/cli/dist/mcp-tool-inventory.js";
import { REQUIRED_PRODUCT_TOOLS } from "../packages/cli/dist/mcp-readiness.js";
import { runProgram } from "../packages/cli/dist/program.js";

test("fonte setup --json reaches the shared readiness projection", async () => {
  assert.deepEqual(parseArguments(["setup", "--json"]), {
    command: "setup",
    apply: false,
    json: true,
  });
  assert.deepEqual(
    parseArguments(["setup", "--workspace", "demo-workspace", "--json"]),
    {
      command: "setup",
      apply: false,
      json: true,
      workspaceSlug: "demo-workspace",
    },
  );
  assert.throws(() => parseArguments(["setup"]));

  let config = "";
  let selected = null;
  let configWrites = 0;
  let workspaceWrites = 0;
  const result = await runProgram(["setup", "--json"], {
    cwd: tmpdir(),
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    runner: { run: async () => 1 },
    setup: {
      codexConfig: {
        readText: async () => config,
        writeText: async (expected, next) => {
          assert.equal(config, expected);
          config = next;
          configWrites += 1;
        },
      },
      locateInstalledHost: async () => ({
        command: "/fixture/node",
        args: ["/fixture/dist/mcp-main.js"],
      }),
      inspectInstalledHost: async () => ({
        initialized: true,
        tools: [...REQUIRED_PRODUCT_TOOLS],
      }),
      readSession: async () => ({
        status: { state: "ready", serverCheck: "not_checked" },
        storageAvailable: true,
      }),
      listWorkspaces: async () => [
        { slug: "demo-workspace", name: "Demo Workspace" },
      ],
      readSelectedWorkspace: async () => selected,
      writeSelectedWorkspace: async (slug) => {
        selected = slug;
        workspaceWrites += 1;
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  const readiness = JSON.parse(result.stdout);
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.selected_workspace.slug, "demo-workspace");
  assert.equal(configWrites, 1);
  assert.equal(workspaceWrites, 1);
  assert.match(config, /\[mcp_servers\.fonte\]/u);
});

test("fresh MCP process presents one question and keeps Send explicit", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fon742-fresh-"));
  const proofFile = path.join(directory, "effects.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = startMcp(proofFile);
  t.after(() => host.close());

  const initialized = await host.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fresh-fonte-agent", version: "1" },
  });
  assert.equal(initialized.result.serverInfo.name, "fonte");
  host.notify("notifications/initialized", {});

  const listed = await host.request("tools/list", {});
  const tools = listed.result.tools;
  const names = tools.map(({ name }) => name);
  assert.deepEqual(names, [...MCP_FONTE_TOOLS]);
  assert.equal(names.length, 41);
  assert.equal(new Set(names).size, 41);

  const statusTool = tools.find(({ name }) => name === "fonte_status");
  const prepareTool = tools.find(
    ({ name }) => name === "fonte_prepare_broadcast",
  );
  const sendTool = tools.find(({ name }) => name === "fonte_send_broadcast");
  assert.equal(statusTool.annotations.readOnlyHint, true);
  assert.equal(prepareTool.annotations.destructiveHint, false);
  assert.equal(sendTool.annotations.destructiveHint, true);
  assert.match(sendTool.description, /exact preparation_reference/u);

  const status = await host.call("fonte_status", {});
  assert.equal(status.state, "ready");
  assert.equal(status.selected_workspace.slug, "demo-workspace");

  const prepare = await host.call("fonte_prepare_broadcast", {});
  assert.equal(prepare.status, "needs_input");
  assert.deepEqual(prepare.missing, ["draft_id_or_create_new"]);
  assert.deepEqual(prepare.choices, [
    {
      field: "create_new",
      value: "true",
      label: "Create one new draft",
    },
  ]);
  assert.equal(prepare.send_input, null);

  await host.close();
  const effects = JSON.parse(await readFile(proofFile, "utf8"));
  assert.deepEqual(effects, { providerAcquisitions: 0, coreRequests: 0 });
  t.diagnostic(
    JSON.stringify(
      {
        user: "Prepare today’s Broadcast. Don’t send it.",
        tools_discovered: [
          "fonte_status",
          "fonte_prepare_broadcast",
          "fonte_send_broadcast",
        ],
        status: {
          state: status.state,
          selected_workspace: status.selected_workspace.slug,
        },
        prepare: {
          status: prepare.status,
          missing: prepare.missing,
          choices: prepare.choices,
          send_input: prepare.send_input,
        },
        send: {
          available: true,
          destructive: sendTool.annotations.destructiveHint,
        },
        provider_effects_during_prepare: effects,
      },
      null,
      2,
    ),
  );
});

function startMcp(proofFile) {
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cli-mcp-fon742-fresh-process.mjs"],
    {
      cwd: process.cwd(),
      env: { ...process.env, FON742_PROOF_FILE: proofFile },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  let stderr = "";
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if ("id" in message) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve) => child.once("exit", resolve));
  return {
    request(method, params) {
      id += 1;
      const requestId = id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`timed out waiting for ${method}`));
        }, 10_000);
        pending.set(requestId, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
        );
      });
    },
    notify(method, params) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    async call(name, args) {
      const value = await this.request("tools/call", {
        name,
        arguments: args,
      });
      assert.equal(value.error, undefined);
      return value.result.structuredContent;
    },
    async close() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await exit;
      lines.close();
      assert.equal(stderr, "");
    },
  };
}
