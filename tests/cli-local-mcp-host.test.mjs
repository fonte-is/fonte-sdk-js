import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import {
  inspectInstalledLocalMcpHost,
  locateInstalledLocalMcpHost,
} from "../packages/cli/dist/local-mcp-host.js";
import { REQUIRED_PRODUCT_TOOLS } from "../packages/cli/dist/mcp-readiness.js";

test("local host resolution points inside the package executing setup", async () => {
  const host = await locateInstalledLocalMcpHost();

  assert.equal(host.command.startsWith("/"), true);
  assert.match(host.args[0], /\/packages\/cli\/dist\/mcp-main\.js$/);
  assert.match(host.packageRoot, /\/packages\/cli$/);
});

test("host probe initializes and lists tools through a deterministic stdio fixture", async () => {
  const calls = [];
  const child = fixtureProcess((message) => {
    calls.push(message.method);
    if (message.method === "initialize")
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: {},
        },
      };
    if (message.method === "tools/list")
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: REQUIRED_PRODUCT_TOOLS.map((name) => ({ name })) },
      };
    return null;
  });
  let killCount = 0;
  child.kill = () => {
    killCount += 1;
    return true;
  };
  let spawnOptions;

  const result = await inspectInstalledLocalMcpHost(
    { command: "/runtime/node", args: ["/package/dist/mcp-main.js"] },
    {
      timeoutMs: 100,
      spawnProcess: (command, args, options) => {
        assert.equal(command, "/runtime/node");
        assert.deepEqual(args, ["/package/dist/mcp-main.js"]);
        spawnOptions = options;
        return child;
      },
    },
  );

  assert.equal(result.initialized, true);
  assert.deepEqual(result.tools, REQUIRED_PRODUCT_TOOLS);
  assert.deepEqual(calls, [
    "initialize",
    "notifications/initialized",
    "tools/list",
  ]);
  assert.equal(spawnOptions.env.FONTE_NONINTERACTIVE, "1");
  assert.equal("FONTE_ACCESS_TOKEN" in spawnOptions.env, false);
  assert.equal(killCount, 2);
});

function fixtureProcess(onRequest) {
  const stdout = new PassThrough();
  let remainder = "";
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      remainder += chunk.toString("utf8");
      const lines = remainder.split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const message = JSON.parse(line);
        const response = onRequest(message);
        if (response) stdout.write(`${JSON.stringify(response)}\n`);
      }
      callback();
    },
  });
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stdin = stdin;
  child.kill = () => true;
  return child;
}
