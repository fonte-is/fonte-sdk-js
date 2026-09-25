import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../dist/arguments.js";
import { installedReleaseExecutorPath, runReleaseCommand } from "../dist/release-command.js";

const source = "a".repeat(40);
const toolingRevision = "5c9af4f808936126cd86478df90a125300f83703";

function releaseRunner({ installed = true, dirtySource = false, sourceRemote = "https://github.com/fonte-is/fonte-core.git" } = {}) {
  const calls = [];
  return {
    calls,
    async run(command, args, cwd) {
      calls.push({ command, args: [...args], cwd });
      if (command === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${cwd.includes("/release-tooling/") && args[2] === "HEAD^{commit}" ? toolingRevision : source}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "remote") {
        return { exitCode: 0, stdout: `${cwd.includes("/release-tooling/") ? "https://github.com/fonte-is/fonte-core.git" : sourceRemote}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "status") {
        return { exitCode: 0, stdout: dirtySource && !cwd.includes("/release-tooling/") ? " M source.ts\n" : "", stderr: "" };
      }
      if (command === "git" && args[0] === "cat-file") {
        return { exitCode: installed ? 0 : 1, stdout: "", stderr: installed ? "" : "missing" };
      }
      if (command === "git" && args[0] === "fetch") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "worktree") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === process.execPath) {
        return { exitCode: 0, stdout: "release_status=VERIFIED\n", stderr: "" };
      }
      return { exitCode: 127, stdout: "", stderr: "unexpected executable" };
    },
  };
}

test("release uses one installed executor from Core, umbrella, and with the old worktree absent", async () => {
  const executor = installedReleaseExecutorPath();
  assert.ok(executor.endsWith(`release-tooling/${toolingRevision}/.github/scripts/production-release-direct.mjs`));
  const locations = ["/checkout/fonte-core", "/checkout/fonte-repos", "/private/tmp/old-fon776-worktree-absent"];
  for (const location of locations) {
    const runner = releaseRunner();
    const result = await runReleaseCommand(source, location, runner);
    assert.equal(result.exitCode, 0, location);
    const invocation = runner.calls.find(({ command }) => command === process.execPath);
    assert.deepEqual(invocation.args, [executor, "--source", source]);
    assert.match(invocation.cwd, /fonte-release-source-/u);
    assert.equal(runner.calls.some(({ command, args }) => command === "git" && args[0] === "worktree" && args[1] === "add"), true);
    assert.equal(runner.calls.some(({ command, args }) => command === "git" && args[0] === "worktree" && args[1] === "remove"), true);
    assert.equal(runner.calls.some(({ command }) => command === "release" || command === "gh"), false);
    assert.equal(runner.calls.some(({ cwd }) => cwd === location), false);
  }
});

test("release without flags uses clean Core HEAD and the same installed executor", async () => {
  assert.deepEqual(parseArguments(["release"]), { command: "release", apply: false, json: false });
  const runner = releaseRunner();
  const result = await runReleaseCommand(undefined, "/checkout/fonte-core", runner);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(runner.calls.slice(0, 3).map(({ command, args, cwd }) => [command, args[0], cwd]), [
    ["git", "remote", "/checkout/fonte-core"],
    ["git", "status", "/checkout/fonte-core"],
    ["git", "rev-parse", "/checkout/fonte-core"],
  ]);
  assert.deepEqual(runner.calls.find(({ command }) => command === process.execPath).args,
    [installedReleaseExecutorPath(), "--source", source]);
});

test("release without flags rejects a dirty or non-Core checkout before effects", async () => {
  for (const options of [{ dirtySource: true }, { sourceRemote: "https://github.com/fonte-is/other.git" }]) {
    const runner = releaseRunner(options);
    const result = await runReleaseCommand(undefined, "/checkout/fonte-core", runner);
    assert.equal(result.exitCode, 3);
    assert.equal(runner.calls.some(({ command }) => command === process.execPath), false);
  }
});

test("release blocks when the pinned installed executor is absent", async () => {
  const runner = releaseRunner({ installed: false });
  const result = await runReleaseCommand(source, "/checkout/fonte-core", runner);
  assert.equal(result.exitCode, 3);
  assert.match(result.stdout, /direct_executor_unavailable/u);
  assert.equal(runner.calls.some(({ command }) => command === process.execPath), false);
});
