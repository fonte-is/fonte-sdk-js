import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { RELEASE_HELP_TEXT } from "../packages/cli/dist/constants.js";
import { runProgram } from "../packages/cli/dist/program.js";

const source = "a".repeat(40);
const runtimeResult = { exitCode: 0, stdout: `{"status":"VERIFIED","source":"${source}"}\n`, stderr: "" };

function dependencies(options = {}) {
  const calls = [];
  const releaseRunner = {
    async run(command, args, cwd) {
      calls.push({ command, args: [...args], cwd });
      if (command === "release") return runtimeResult;
      if (command === "git" && args[0] === "status") {
        return { exitCode: 0, stdout: options.dirty ? " M file.ts\n" : "", stderr: "" };
      }
      if (command === "git" && args[0] === "fetch") {
        return { exitCode: options.fetchFailed ? 1 : 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${options.resolved ?? source}\n`, stderr: "" };
      }
      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    },
  };
  return {
    calls,
    dependencies: {
      cwd: "/work/repo",
      randomUUID: () => "10000000-0000-4000-8000-000000000009",
      runner: { run: async () => 1 },
      releaseRunner,
    },
  };
}

test("release accepts exactly an explicit full commit SHA", () => {
  assert.deepEqual(parseArguments(["release", "--source", source]), {
    command: "release", apply: false, json: false, releaseSource: source,
  });
  assert.equal(parseArguments(["release", "--help"]).helpText, RELEASE_HELP_TEXT);
  for (const argv of [
    ["release"],
    ["release", "--source"],
    ["release", "--source", "local-branch"],
    ["release", "--source", source, "--target", "api"],
    ["release", "--source", source, "--confirm", "prod"],
  ]) assert.throws(() => parseArguments(argv));
});

test("release sends only the fetched exact SHA to the installed runtime", async () => {
  const setup = dependencies();
  const result = await runProgram(["release", "--source", source], setup.dependencies);
  assert.deepEqual(result, runtimeResult);
  assert.deepEqual(setup.calls, [
    { command: "git", args: ["status", "--porcelain=v1", "--untracked-files=all"], cwd: "/work/repo" },
    { command: "git", args: ["fetch", "--quiet", "--no-tags", "origin", source], cwd: "/work/repo" },
    { command: "git", args: ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], cwd: "/work/repo" },
    { command: "release", args: ["--source", source], cwd: "/work/repo" },
  ]);
});

test("release refuses dirty, unpushed, or mismatched sources before runtime invocation", async () => {
  for (const options of [{ dirty: true }, { fetchFailed: true }, { resolved: "b".repeat(40) }]) {
    const setup = dependencies(options);
    const result = await runProgram(["release", "--source", source], setup.dependencies);
    assert.equal(result.exitCode, 3);
    assert.notEqual(setup.calls.at(-1)?.command, "release");
  }
});
