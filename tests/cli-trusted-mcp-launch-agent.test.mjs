import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureTrustedMcpLaunchAgent } from "../packages/cli/dist/trusted-mcp-host-launch-agent.js";

test("setup installs and starts a private per-user macOS LaunchAgent", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "fonte-launch-agent-"));
  const plist = path.join(
    home,
    "Library",
    "LaunchAgents",
    "is.fonte.cli-local-mcp.plist",
  );
  const calls = [];
  let loaded = false;
  t.after(() => rm(home, { recursive: true, force: true }));

  const options = {
    host: {
      command: "/runtime/node",
      args: ["/package/dist/mcp-host-main.js"],
    },
    platform: "darwin",
    arch: "arm64",
    home,
    uid: process.getuid(),
    async launchctl(args) {
      calls.push([...args]);
      if (args[0] === "print" && !loaded) throw new Error("not-loaded");
      if (args[0] === "bootstrap") loaded = true;
      if (args[0] === "bootout") loaded = false;
    },
  };

  await ensureTrustedMcpLaunchAgent(options);
  const metadata = await lstat(plist);
  const body = await readFile(plist, "utf8");
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.match(body, /<key>RunAtLoad<\/key><true\/>/u);
  assert.match(body, /<key>KeepAlive<\/key><true\/>/u);
  assert.match(body, /\/package\/dist\/mcp-host-main\.js/u);
  assert.match(
    body,
    /<key>StandardOutPath<\/key><string>\/dev\/null<\/string>/u,
  );
  assert.match(
    body,
    /<key>StandardErrorPath<\/key><string>\/dev\/null<\/string>/u,
  );
  assert.doesNotMatch(body, /Bearer\s|accessToken|refreshToken|credential/i);
  assert.deepEqual(
    calls.map(([command]) => command),
    ["print", "bootstrap", "kickstart"],
  );

  calls.length = 0;
  await ensureTrustedMcpLaunchAgent(options);
  assert.deepEqual(
    calls.map(([command]) => command),
    ["print", "kickstart"],
  );

  calls.length = 0;
  await ensureTrustedMcpLaunchAgent({
    ...options,
    host: { command: "/runtime/node", args: ["/new/package/mcp-host-main.js"] },
  });
  assert.deepEqual(
    calls.map(([command]) => command),
    ["print", "bootout", "bootstrap", "kickstart"],
  );
});

test("setup does not install a user service outside the macOS arm64 cut", async () => {
  let calls = 0;
  await ensureTrustedMcpLaunchAgent({
    host: { command: "/runtime/node", args: ["/package/host.js"] },
    platform: "linux",
    arch: "x64",
    uid: process.getuid(),
    launchctl: async () => {
      calls += 1;
    },
  });
  assert.equal(calls, 0);
});
