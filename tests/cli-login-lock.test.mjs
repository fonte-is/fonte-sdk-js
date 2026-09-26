import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import {
  CLIENT_AUTH_LOCK_PORT,
  LoopbackLoginLock,
} from "../packages/cli/dist/login-lock.js";

test("the v1 session slot is isolated from the historical MCP port", async () => {
  assert.equal(CLIENT_AUTH_LOCK_PORT, 49_673);
  const historicalMcp = createServer();
  await listen(historicalMcp, 49_672);
  try {
    assert.equal(
      await new LoopbackLoginLock(CLIENT_AUTH_LOCK_PORT, 200, 10).run(
        async () => "isolated",
      ),
      "isolated",
    );
  } finally {
    await close(historicalMcp);
  }
});

test("separate owners serialize operations and release after failures", async () => {
  const port = await unusedPort();
  const first = new LoopbackLoginLock(port, 500, 10);
  const second = new LoopbackLoginLock(port, 500, 10);
  let running = 0;
  const events = [];
  const operation = (name) => async () => {
    assert.equal(running++, 0);
    events.push(`${name}:start`);
    await delay(30);
    events.push(`${name}:finish`);
    assert.equal(--running, 0);
    return name;
  };
  assert.deepEqual(
    await Promise.all([
      first.run(operation("refresh")),
      second.run(operation("logout")),
    ]),
    ["refresh", "logout"],
  );
  assert.deepEqual(events, [
    "refresh:start",
    "refresh:finish",
    "logout:start",
    "logout:finish",
  ]);
  const error = new Error("synthetic operation failed");
  await assert.rejects(
    first.run(async () => {
      throw error;
    }),
    (actual) => actual === error,
  );
  assert.equal(await second.run(async () => "released"), "released");
});

test("unrelated occupied port is a bounded denial and receives no protocol traffic", async () => {
  let connections = 0;
  const blocker = createServer(() => {
    connections += 1;
  });
  await listen(blocker, 0);
  try {
    const port = blocker.address().port;
    let calls = 0;
    const start = performance.now();
    await assert.rejects(
      new LoopbackLoginLock(port, 60, 10).run(async () => {
        calls += 1;
      }),
      loginBusy,
    );
    assert.equal(calls, 0);
    assert.equal(connections, 0);
    assert.ok(performance.now() - start < 1_000);
  } finally {
    await close(blocker);
  }
});

test("abort stops acquisition without running the operation or leaving a reservation", async () => {
  const blocker = createServer();
  await listen(blocker, 0);
  const port = blocker.address().port;
  const signal = new AbortController();
  let calls = 0;
  try {
    const pending = new LoopbackLoginLock(port, 5_000, 10).run(async () => {
      calls += 1;
    }, signal.signal);
    signal.abort(new Error("synthetic private cancellation reason"));
    await assert.rejects(pending, loginBusy);
    assert.equal(calls, 0);
  } finally {
    await close(blocker);
  }
  const freePortAbort = new AbortController();
  const pendingListen = new LoopbackLoginLock(port, 300, 10).run(async () => {
    calls += 1;
  }, freePortAbort.signal);
  freePortAbort.abort();
  await assert.rejects(pendingListen, loginBusy);
  assert.equal(
    await new LoopbackLoginLock(port, 300, 10).run(async () => "acquired"),
    "acquired",
  );
  await assert.rejects(
    new LoopbackLoginLock(port).run(async () => {
      calls += 1;
    }, signal.signal),
    loginBusy,
  );
  assert.equal(calls, 0);
});

test("aborting an active owner does not release custody while its operation is still running", async (t) => {
  const port = await unusedPort();
  const signal = new AbortController();
  const started = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  const owner = new LoopbackLoginLock(port).run(async () => {
    started.resolve();
    await finish.promise;
    return "finished";
  }, signal.signal);
  await Promise.race([started.promise, owner]);
  signal.abort();
  await assert.rejects(
    new LoopbackLoginLock(port, 30, 10).run(async () => "overlap"),
    loginBusy,
  );
  finish.resolve();
  assert.equal(await owner, "finished");
  assert.equal(
    await new LoopbackLoginLock(port).run(async () => "next"),
    "next",
  );
});

test("lock rejects unsolicited connections without accepting secrets or delaying release", async () => {
  const port = await unusedPort();
  let received = "";
  await new LoopbackLoginLock(port).run(async () => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.on("data", (data) => {
      received += data.toString();
    });
    socket.on("error", () => {});
    await new Promise((resolve) => socket.once("close", resolve));
  });
  assert.equal(received, "");
  assert.equal(
    await new LoopbackLoginLock(port).run(async () => "released"),
    "released",
  );
});

test(
  "OS releases cross-process custody after a killed owner",
  { timeout: 10_000 },
  async (t) => {
    const port = await unusedPort();
    const moduleUrl = new URL(
      "../packages/cli/dist/login-lock.js",
      import.meta.url,
    ).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
    import { LoopbackLoginLock } from ${JSON.stringify(moduleUrl)};
    await new LoopbackLoginLock(${port}).run(async () => {
      process.send("synthetic-lock-acquired");
      await new Promise(() => {});
    });
  `,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });
    let diagnostics = "";
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.toString();
    });
    try {
      const first = await Promise.race([
        once(child, "message", { signal: t.signal }),
        once(child, "exit", { signal: t.signal }).then(() => {
          throw new Error(`synthetic child exited: ${diagnostics}`);
        }),
      ]);
      assert.equal(first[0], "synthetic-lock-acquired");
      await assert.rejects(
        new LoopbackLoginLock(port, 30, 10).run(async () => "overlap"),
        loginBusy,
      );
      const exited = once(child, "exit", { signal: t.signal });
      child.kill("SIGKILL");
      await exited;
      assert.equal(
        await new LoopbackLoginLock(port, 500, 10).run(async () => "recovered"),
        "recovered",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  },
);

function loginBusy(error) {
  assert.ok(error instanceof HostedTestBlockedError);
  assert.equal(error.reason, "login_busy");
  assert.equal(error.message, "login_busy");
  assert.equal(error.cause, undefined);
  return true;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function unusedPort() {
  const server = createServer();
  await listen(server, 0);
  const port = server.address().port;
  await close(server);
  return port;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
