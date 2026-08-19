import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAuthorizedConsumer } from "../packages/cli/dist/auth-exec.js";
import {
  AUTHORIZED_BEARER_ENV,
  spawnAuthorizedConsumer,
} from "../packages/cli/dist/authorized-consumer.js";
import { AUTHORIZATION_ERROR_TEXT } from "../packages/cli/dist/constants.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { authorizeWithBrowser } from "../packages/cli/dist/oauth.js";
import { parseOAuthCallback } from "../packages/cli/dist/oauth-callback.js";
import { runProgram } from "../packages/cli/dist/program.js";

const bearer = "header.payload.signature";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("browser authorization orchestrates a mocked IdP without changing callback authority", async () => {
  let closed = false;
  let opened = "";
  const token = await authorizeWithBrowser(
    config,
    {},
    {
      prepare: async (received) => {
        assert.deepEqual(received, config);
        return {
          state: "expected-state",
          authorizationUrl: new URL("https://identity.example.test/authorize"),
          exchange: async (callback) => {
            assert.equal(callback.searchParams.get("code"), "synthetic-code");
            return bearer;
          },
        };
      },
      listenForOAuthCallback: async (state) => {
        assert.equal(state, "expected-state");
        return {
          callback: Promise.resolve(
            parseOAuthCallback(
              "/callback?code=synthetic-code&state=expected-state",
              "127.0.0.1:49671",
              state,
            ),
          ),
          close: () => {
            closed = true;
          },
        };
      },
      openBrowser: async (url) => {
        opened = url.toString();
        return true;
      },
    },
  );

  assert.equal(token, bearer);
  assert.equal(opened, "https://identity.example.test/authorize");
  assert.equal(closed, true);
  assert.throws(() =>
    parseOAuthCallback(
      "/wrong?code=synthetic-code&state=expected-state",
      "127.0.0.1:49671",
      "expected-state",
    ),
  );
});

test("browser authorization cancellation and callback timeout fail closed", async () => {
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(
    authorizeWithBrowser(
      config,
      { signal: cancellation.signal },
      {
        prepare: async () =>
          assert.fail("cancelled authorization must not prepare"),
        listenForOAuthCallback: async () =>
          assert.fail("cancelled authorization must not listen"),
        openBrowser: async () =>
          assert.fail("cancelled authorization must not open"),
      },
    ),
    /authorization_cancelled/,
  );

  let closed = false;
  await assert.rejects(
    authorizeWithBrowser(
      config,
      {},
      {
        prepare: async () => ({
          state: "timeout-state",
          authorizationUrl: new URL("https://identity.example.test/authorize"),
          exchange: async () =>
            assert.fail("a timed out callback must not exchange a code"),
        }),
        listenForOAuthCallback: async () => ({
          callback: Promise.reject(
            new HostedTestBlockedError("authorization_timeout"),
          ),
          close: () => {
            closed = true;
          },
        }),
        openBrowser: async () => true,
      },
    ),
    /authorization_timeout/,
  );
  assert.equal(closed, true);
});

test("authorized orchestration performs only hosted discovery and a direct child handoff", async () => {
  const calls = [];
  let requests = 0;
  await runAuthorizedConsumer("node", ["local-bootstrap.mjs"], {
    fetch: async () => {
      requests += 1;
      return json(config);
    },
    authorize: async (received) => {
      assert.deepEqual(received, config);
      return bearer;
    },
    spawn: async (command, args, receivedBearer) => {
      calls.push({ command, args, receivedBearer });
    },
  });

  assert.equal(requests, 1);
  assert.deepEqual(calls, [
    {
      command: "node",
      args: ["local-bootstrap.mjs"],
      receivedBearer: bearer,
    },
  ]);
});

test("the direct child receives the bearer only through its environment", async () => {
  const script = [
    `const token = process.env.${AUTHORIZED_BEARER_ENV};`,
    "if (!token || process.argv.includes(token)) process.exit(9);",
    `delete process.env.${AUTHORIZED_BEARER_ENV};`,
  ].join("");

  await spawnAuthorizedConsumer(
    process.execPath,
    ["--input-type=module", "--eval", script],
    bearer,
  );
  assert.equal(process.env[AUTHORIZED_BEARER_ENV], undefined);
});

test("child failure does not render or persist the bearer", async () => {
  await assert.rejects(
    spawnAuthorizedConsumer(
      process.execPath,
      ["--input-type=module", "--eval", "process.exit(7)"],
      bearer,
    ),
    /execution_failed/,
  );
  assert.equal(process.env[AUTHORIZED_BEARER_ENV], undefined);
});

test("cancellation force-closes an ignoring consumer process group", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fonte-auth-tree-"));
  const pidFile = path.join(directory, "pids.json");
  const cancellation = new AbortController();
  let pending;
  let addedListeners = 0;
  let removedListeners = 0;
  const observedSignal = {
    get aborted() {
      return cancellation.signal.aborted;
    },
    addEventListener(...args) {
      addedListeners += 1;
      cancellation.signal.addEventListener(...args);
    },
    removeEventListener(...args) {
      removedListeners += 1;
      cancellation.signal.removeEventListener(...args);
    },
  };

  try {
    const descendantScript = [
      'process.on("SIGTERM", () => {});',
      `if (!process.env.${AUTHORIZED_BEARER_ENV}) process.exit(9);`,
      'process.send?.("ready");',
      "setInterval(() => {}, 1000);",
    ].join("");
    const consumerScript = [
      'process.on("SIGTERM", () => {});',
      "const descendant = spawn(process.execPath,",
      `["--input-type=module", "--eval", ${JSON.stringify(descendantScript)}],`,
      '{ stdio: ["ignore", "ignore", "ignore", "ipc"] });',
      'descendant.once("message", () => {',
      `  writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, descendant.pid]));`,
      "});",
      "setInterval(() => {}, 1000);",
    ].join("");
    pending = spawnAuthorizedConsumer(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import { spawn } from "node:child_process"; ' +
          'import { writeFileSync } from "node:fs"; ' +
          consumerScript,
      ],
      bearer,
      observedSignal,
    );
    const pids = await readPids(pidFile);

    cancellation.abort();
    await assert.rejects(pending, /authorization_cancelled/);

    for (const pid of pids) assertProcessExited(pid);
    assert.equal(addedListeners, 1);
    assert.equal(removedListeners, 1);
    assert.equal(process.env[AUTHORIZED_BEARER_ENV], undefined);
  } finally {
    cancellation.abort();
    await pending?.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test("the public exec command emits no token or receipt and skips project and provider work", async () => {
  let spawnCall;
  const result = await runProgram(
    ["auth", "exec", "--", "node", "local-bootstrap.mjs"],
    {
      cwd: "/unused-by-auth-exec",
      randomUUID: () => assert.fail("auth exec must not create an identity"),
      runner: { run: async () => assert.fail("auth exec must not run npm") },
      authExec: {
        fetch: async () => json(config),
        authorize: async () => bearer,
        spawn: async (command, args, receivedBearer) => {
          spawnCall = { command, args, receivedBearer };
        },
      },
    },
  );

  assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
  assert.deepEqual(spawnCall, {
    command: "node",
    args: ["local-bootstrap.mjs"],
    receivedBearer: bearer,
  });
  assert.equal(JSON.stringify(result).includes(bearer), false);
});

test("authorization and child failures use bounded token-free results", async () => {
  const base = {
    cwd: "/unused-by-auth-exec",
    randomUUID: () => "unused",
    runner: { run: async () => 1 },
  };
  const authorization = await runProgram(["auth", "exec", "--", "node"], {
    ...base,
    authExec: {
      fetch: async () => json(config),
      authorize: async () => {
        throw new HostedTestBlockedError("authorization_timeout");
      },
      spawn: async () => assert.fail("failed authorization must not spawn"),
    },
  });
  assert.deepEqual(authorization, {
    exitCode: 3,
    stdout: "",
    stderr: AUTHORIZATION_ERROR_TEXT,
  });

  const child = await runProgram(["auth", "exec", "--", "missing"], {
    ...base,
    authExec: {
      fetch: async () => json(config),
      authorize: async () => bearer,
      spawn: async () => {
        throw new Error("synthetic child failure");
      },
    },
  });
  assert.equal(child.exitCode, 1);
  assert.equal(JSON.stringify([authorization, child]).includes(bearer), false);
});

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function readPids(pidFile) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(pidFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.fail("consumer process group did not become ready");
}

function assertProcessExited(pid) {
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error?.code === "ESRCH",
  );
}
