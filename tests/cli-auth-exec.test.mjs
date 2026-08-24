import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
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
import { listenForOAuthCallback } from "../packages/cli/dist/loopback-callback.js";
import {
  authorizeWithBrowser,
  createBrowserAuthorizationSession,
} from "../packages/cli/dist/oauth.js";
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

test("one in-memory authorization refreshes opaque tokens only at their expires-in lead window", async () => {
  const firstRefreshToken = "synthetic-refresh-secret-one";
  const rotatedRefreshToken = "synthetic-refresh-secret-two";
  const refreshTokens = [];
  let now = 1_000_000;
  let prepared = 0;
  let listened = 0;
  let opened = 0;
  let exchanged = 0;
  let closed = 0;
  const session = createBrowserAuthorizationSession({
    prepare: async () => {
      prepared += 1;
      return {
        state: "session-state",
        authorizationUrl: new URL("https://identity.example.test/authorize"),
        exchange: async () => {
          exchanged += 1;
          return {
            accessToken: "opaque-access-one",
            refreshToken: firstRefreshToken,
            expiresInSeconds: 120,
          };
        },
        refresh: async (refreshToken) => {
          refreshTokens.push(refreshToken);
          if (refreshToken === firstRefreshToken) {
            return {
              accessToken: "opaque-access-two",
              refreshToken: rotatedRefreshToken,
              expiresInSeconds: 120,
            };
          }
          return {
            accessToken: "opaque-access-three",
            expiresInSeconds: 120,
          };
        },
      };
    },
    listenForOAuthCallback: async () => {
      listened += 1;
      return {
        callback: Promise.resolve(
          new URL(
            "http://127.0.0.1:49671/callback?code=synthetic-code&state=session-state",
          ),
        ),
        close: () => {
          closed += 1;
        },
      };
    },
    openBrowser: async () => {
      opened += 1;
      return true;
    },
    now: () => now,
  });

  assert.deepEqual(
    await Promise.all([session.authorize(config), session.authorize(config)]),
    ["opaque-access-one", "opaque-access-one"],
  );
  now += 89_999;
  assert.deepEqual(
    await Promise.all([session.authorize(config), session.authorize(config)]),
    ["opaque-access-one", "opaque-access-one"],
  );
  assert.deepEqual(refreshTokens, []);

  now += 1;
  assert.deepEqual(
    await Promise.all([session.authorize(config), session.authorize(config)]),
    ["opaque-access-two", "opaque-access-two"],
  );
  assert.deepEqual(refreshTokens, [firstRefreshToken]);

  now += 89_999;
  assert.equal(await session.authorize(config), "opaque-access-two");
  assert.deepEqual(refreshTokens, [firstRefreshToken]);

  now += 1;
  assert.deepEqual(
    await Promise.all([session.authorize(config), session.authorize(config)]),
    ["opaque-access-three", "opaque-access-three"],
  );

  assert.equal(prepared, 1);
  assert.equal(listened, 1);
  assert.equal(opened, 1);
  assert.equal(exchanged, 1);
  assert.equal(closed, 1);
  assert.deepEqual(refreshTokens, [firstRefreshToken, rotatedRefreshToken]);
  assert.equal(
    JSON.stringify(session).includes(firstRefreshToken) ||
      JSON.stringify(session).includes(rotatedRefreshToken),
    false,
  );
});

test("the refresh-capable session is wired only to operator runtime", async () => {
  const source = await readFile(
    new URL("../packages/cli/src/main.ts", import.meta.url),
    "utf8",
  );
  const authExec = source.match(
    /authExec: \{([\s\S]*?)\n  \},\n  operator:/,
  )?.[1];
  const operator = source.match(
    /operator: \{([\s\S]*?)\n  \},\n  hosted:/,
  )?.[1];
  const hosted = source.match(
    /hosted: \{([\s\S]*?)\n  \},\n\}\)\.finally/,
  )?.[1];

  assert.match(
    source,
    /const operatorAuthorization = broadcastCanaryInvocation\s+\? createBrowserAuthorizationSession\(\)\s+: null;/,
  );
  assert.match(authExec ?? "", /authorize: authorizeOnce,/);
  assert.doesNotMatch(authExec ?? "", /operatorAuthorization/);
  assert.match(operator ?? "", /authorize: operatorAuthorization\.authorize,/);
  assert.match(operator ?? "", /renewAuthorization:/);
  assert.match(operator ?? "", /: \{ authorize: authorizeOnce \}/);
  assert.match(
    hosted ?? "",
    /authorize: \(config\) => authorizeWithBrowser\(config\),/,
  );
  assert.doesNotMatch(hosted ?? "", /operatorAuthorization/);
});

test("refresh failure is cached, token-free, and never falls back to another browser", async () => {
  const refreshToken = "synthetic-refresh-secret-failure";
  let opened = 0;
  let refreshAttempts = 0;
  const session = createBrowserAuthorizationSession({
    prepare: async () => ({
      state: "failure-state",
      authorizationUrl: new URL("https://identity.example.test/authorize"),
      exchange: async () => ({
        accessToken: "synthetic-access-before-failure",
        refreshToken,
        expiresInSeconds: 300,
      }),
      refresh: async () => {
        refreshAttempts += 1;
        throw new Error(`authorization server rejected ${refreshToken}`);
      },
    }),
    listenForOAuthCallback: async () => ({
      callback: Promise.resolve(
        new URL(
          "http://127.0.0.1:49671/callback?code=synthetic-code&state=failure-state",
        ),
      ),
      close: () => {},
    }),
    openBrowser: async () => {
      opened += 1;
      return true;
    },
  });

  await session.authorize(config);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      session.refresh(config),
      (error) =>
        error instanceof HostedTestBlockedError &&
        error.reason === "authorization_refresh_failed" &&
        !error.message.includes(refreshToken),
    );
  }
  assert.equal(opened, 1);
  assert.equal(refreshAttempts, 1);
  assert.equal(JSON.stringify(session).includes(refreshToken), false);
});

test("a preliminary loopback request cannot consume the exact authorized callback", async () => {
  const listener = await listenForOAuthCallback("expected-state", {
    bindPort: 0,
    timeoutMs: 5_000,
  });
  try {
    const preliminary = await requestCallback(
      listener.boundPort,
      "/callback?state=expected-state",
    );
    assert.equal(preliminary.status, 400);
    assert.match(preliminary.body, /Authorization not completed/);

    const accepted = await requestCallback(
      listener.boundPort,
      "/callback?code=synthetic-code&state=expected-state",
    );
    assert.equal(accepted.status, 200);
    assert.match(accepted.body, /Authorization complete/);
    const callback = await listener.callback;
    assert.equal(callback.searchParams.get("code"), "synthetic-code");
    assert.equal(callback.searchParams.get("state"), "expected-state");
  } finally {
    listener.close();
  }
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
  const requestedUrls = [];
  let requests = 0;
  await runAuthorizedConsumer("node", ["local-bootstrap.mjs"], {
    configUrl: "http://127.0.0.1:3000/.well-known/fonte-cli.json",
    fetch: async (input) => {
      requests += 1;
      requestedUrls.push(String(input));
      return json({ ...config, coreApiBaseUrl: "http://127.0.0.1:3010" });
    },
    authorize: async (received) => {
      assert.deepEqual(received, {
        ...config,
        coreApiBaseUrl: "http://127.0.0.1:3010",
      });
      return bearer;
    },
    spawn: async (command, args, receivedBearer) => {
      calls.push({ command, args, receivedBearer });
    },
  });

  assert.equal(requests, 1);
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:3000/.well-known/fonte-cli.json",
  ]);
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

function requestCallback(port, path) {
  return new Promise((resolve, reject) => {
    const pending = request(
      {
        headers: { host: "127.0.0.1:49671" },
        hostname: "127.0.0.1",
        method: "GET",
        path,
        port,
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: chunks.join(""),
            status: response.statusCode,
          }),
        );
      },
    );
    pending.once("error", reject);
    pending.end();
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
