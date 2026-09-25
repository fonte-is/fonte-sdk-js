import assert from "node:assert/strict";
import test from "node:test";
import { runReleaseCommand } from "../dist/release-command.js";

const source = "a".repeat(40);
const main = "b".repeat(40);

function releaseRunner({ executor = true, remoteSource = true } = {}) {
  const calls = [];
  return { calls, async run(command, args, cwd) {
    calls.push({ command, args: [...args], cwd });
    if (command === "git" && args[0] === "rev-parse") {
      const sourceFetch = calls.some(call => call.command === "git" && call.args[0] === "fetch"
        && call.args.at(-1) === source);
      return { exitCode: 0, stdout: `${sourceFetch ? source : main}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "cat-file") {
      return { exitCode: executor ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "fetch" && args.at(-1) === source && !remoteSource) {
      return { exitCode: 1, stdout: "", stderr: "source missing" };
    }
    if (command === process.execPath) {
      return { exitCode: 0, stdout: "release_status=VERIFIED\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  } };
}

test("Core and umbrella invocations use the current canonical release engine without an SDK SHA pin", async () => {
  for (const location of ["/checkout/fonte-core", "/checkout/fonte-repos", "/private/tmp/other"]) {
    const runner = releaseRunner();
    const result = await runReleaseCommand(source, location, runner);
    assert.equal(result.exitCode, 0, location);
    const roots = new Set(runner.calls.map(call => call.cwd));
    assert.equal(roots.size, 1);
    assert.equal(roots.has(location), false);
    assert.deepEqual(runner.calls.filter(call => call.command === "git" && call.args[0] === "fetch")
      .map(call => call.args.at(-1)), ["main", source]);
    assert.deepEqual(runner.calls.find(call => call.command === "git" && call.args[0] === "checkout")?.args,
      ["checkout", "--quiet", "--detach", main]);
    assert.deepEqual(runner.calls.at(-1).args,
      [`${[...roots][0]}/.github/scripts/production-release-direct.mjs`, "--source", source]);
  }
});

test("missing current executor or unresolvable source blocks before release effects", async () => {
  for (const [options, reason] of [[{ executor: false }, "direct_executor_unavailable"],
    [{ remoteSource: false }, "source_not_remote"]]) {
    const runner = releaseRunner(options);
    const result = await runReleaseCommand(source, "/checkout", runner);
    assert.equal(result.exitCode, 3);
    assert.match(result.stdout, new RegExp(reason, "u"));
    assert.equal(runner.calls.some(call => call.command === process.execPath), false);
  }
});
