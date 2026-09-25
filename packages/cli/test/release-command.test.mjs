import assert from "node:assert/strict";
import test from "node:test";
import { installedReleaseExecutorPath, runReleaseCommand } from "../dist/release-command.js";

const source = "a".repeat(40);
const toolingRevision = "a944a2935e14e87c1c6bb5c953230e3d34eb422c";

function releaseRunner({ installed = true } = {}) {
  const calls = [];
  return {
    calls,
    async run(command, args, cwd) {
      calls.push({ command, args: [...args], cwd });
      if (command === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${args[2] === "HEAD^{commit}" ? toolingRevision : source}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "remote") {
        return { exitCode: 0, stdout: "https://github.com/fonte-is/fonte-core.git\n", stderr: "" };
      }
      if (command === "git" && args[0] === "status") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "cat-file") {
        return { exitCode: installed ? 0 : 1, stdout: "", stderr: installed ? "" : "missing" };
      }
      if (command === "git" && args[0] === "fetch") {
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
    assert.equal(runner.calls.at(-1).command, process.execPath);
    assert.deepEqual(runner.calls.at(-1).args, [executor, "--source", source]);
    assert.equal(new Set(runner.calls.map(call => call.cwd)).size, 1);
    assert.equal(runner.calls.some(({ command }) => command === "release" || command === "gh"), false);
    assert.equal(runner.calls.some(({ cwd }) => cwd === location), false);
  }
});

test("release blocks when the pinned installed executor is absent", async () => {
  const runner = releaseRunner({ installed: false });
  const result = await runReleaseCommand(source, "/checkout/fonte-core", runner);
  assert.equal(result.exitCode, 3);
  assert.match(result.stdout, /direct_executor_unavailable/u);
  assert.equal(runner.calls.some(({ command }) => command === process.execPath), false);
});
