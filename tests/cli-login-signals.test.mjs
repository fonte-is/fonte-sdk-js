import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const main = fileURLToPath(
  new URL("../packages/cli/dist/main.js", import.meta.url),
);
const loader = new URL(
  "./fixtures/cli-login-signals-loader.mjs",
  import.meta.url,
).href;
const ordinaryCommand = [
  "broadcast",
  "status",
  "--workspace",
  "demo-store",
  "--environment",
  "production",
  "--broadcast-id",
  "synthetic-broadcast",
];
const options = {
  timeout: 20_000,
  skip:
    process.platform === "win32"
      ? "Requires POSIX subprocess SIGINT delivery"
      : false,
};

function child(t, argv, scenario) {
  const process = fork(main, argv, {
    execArgv: ["--import", loader],
    env: { ...globalThis.process.env, FONTE_SIGNAL_TEST_SCENARIO: scenario },
    silent: true,
  });
  const messages = [];
  let stdout = "";
  let stderr = "";
  process.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  process.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  process.on("message", (message) => messages.push(message));
  const closed = new Promise((resolve, reject) => {
    process.once("error", reject);
    process.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  t.after(async () => {
    if (process.exitCode === null && process.signalCode === null)
      process.kill("SIGKILL");
    await closed;
  });
  return { process, messages, closed };
}

async function waitFor(child, kind) {
  const existing = child.messages.find((message) => message.kind === kind);
  if (existing) return existing;
  let listener;
  try {
    return await Promise.race([
      new Promise((resolve) => {
        listener = (message) => {
          if (message.kind === kind) resolve(message);
        };
        child.process.on("message", listener);
      }),
      child.closed.then((result) => {
        throw new Error(
          `Child exited before ${kind}: ${JSON.stringify(result)}`,
        );
      }),
    ]);
  } finally {
    if (listener) child.process.removeListener("message", listener);
  }
}

test(
  "ordinary implicit-login SIGINT waits for commit cleanup without reporting success",
  options,
  async (t) => {
    const running = child(t, ordinaryCommand, "commit");
    const committing = await waitFor(running, "committing");
    assert.equal(committing.sigintListeners, 1);
    assert.equal(committing.sigtermListeners, 1);
    assert.equal(running.process.kill("SIGINT"), true);
    const result = await running.closed;
    assert.equal(result.signal, null);
    assert.equal(result.code, 3);
    assert.ok(running.messages.some(({ kind }) => kind === "aborted"));
    const cancelled = running.messages.find(
      ({ kind }) => kind === "cancelled_result",
    );
    assert.equal(cancelled.reason, "authorization_cancelled");
    assert.equal(cancelled.stored, false);
    assert.equal(cancelled.credentialPersisted, false);
    assert.equal(cancelled.removals, 1);
    assert.equal(cancelled.phases.at(-1), "cancelled");
    assert.equal(cancelled.phases.includes("complete"), false);
    assert.equal(cancelled.sigintListeners, 0);
    assert.equal(cancelled.sigtermListeners, 0);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(
      JSON.stringify({ result, messages: running.messages }),
      /synthetic-access-token|synthetic-refresh-token|synthetic-subject|unexpected success/,
    );
  },
);

for (const [name, argv, scenario] of [
  ["local command", ["doctor"], "local"],
  ["help", ["--help"], "help"],
  ["ordinary work after login", ordinaryCommand, "after-login"],
]) {
  test(
    `${name} retains default SIGINT termination outside login`,
    options,
    async (t) => {
      const running = child(t, argv, scenario);
      const idle = await waitFor(running, "ordinary_idle");
      assert.equal(idle.sigintListeners, 0);
      assert.equal(idle.sigtermListeners, 0);
      assert.equal(running.process.kill("SIGINT"), true);
      const result = await running.closed;
      assert.equal(result.code, null);
      assert.equal(result.signal, "SIGINT");
      assert.equal(
        running.messages.some(({ kind }) => kind === "aborted"),
        false,
      );
    },
  );
}
