import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { RELEASE_HELP_TEXT } from "../packages/cli/dist/constants.js";
import { runProgram } from "../packages/cli/dist/program.js";

const source = "a".repeat(40);
const runtimeResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    status: "VERIFIED",
    source,
    requestId: "same-request",
  }) + "\n",
  stderr: "",
};

function makeDependencies(options = {}) {
  const calls = [];
  let fetchHead = options.fetchHead ?? source;
  const releaseRunner = {
    async run(command, args, cwd) {
      calls.push({ command, args: [...args], cwd });
      if (command === "release") return runtimeResult;
      if (command !== "git") throw new Error(`unexpected command: ${command}`);
      if (args[0] === "status") {
        return { exitCode: 0, stdout: options.dirty ? " M file.ts\n" : "", stderr: "" };
      }
      if (args[0] === "fetch") {
        if (options.fetchExitCode !== undefined) {
          return { exitCode: options.fetchExitCode, stdout: "", stderr: "remote detail" };
        }
        if (args.at(-1) !== "+refs/heads/main:refs/remotes/origin/main") {
          fetchHead = args.at(-1);
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        const value = args[2] === "FETCH_HEAD^{commit}" ? fetchHead : source;
        return { exitCode: 0, stdout: `${value}\n`, stderr: "" };
      }
      throw new Error(`unexpected git operation: ${args[0]}`);
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

test("release grammar admits only the optional exact source SHA", () => {
  assert.deepEqual(parseArguments(["release"]), {
    command: "release",
    apply: false,
    json: false,
  });
  assert.deepEqual(parseArguments(["release", "--source", source]), {
    command: "release",
    apply: false,
    json: false,
    releaseSource: source,
  });
  assert.equal(parseArguments(["release", "--help"]).helpText, RELEASE_HELP_TEXT);
  for (const argv of [
    ["release", "--source"],
    ["release", "--source", "local-branch"],
    ["release", "--source", source.toUpperCase()],
    ["release", "--source", source, "--source", source],
    ["release", "--confirm", "prod"],
  ]) {
    assert.throws(() => parseArguments(argv));
  }
});

test("release help is local and makes no runtime call", async () => {
  const { calls, dependencies } = makeDependencies();
  const result = await runProgram(["release", "--help"], dependencies);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, RELEASE_HELP_TEXT);
  assert.equal(result.stderr, "");
  assert.equal(calls.length, 0);
});

test("default release fetches clean origin/main and passes its exact SHA to the installed runtime", async () => {
  const { calls, dependencies } = makeDependencies();
  const result = await runProgram(["release"], dependencies);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, runtimeResult.stdout);
  assert.equal(result.stderr, "");
  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
    ["git", ["status", "--porcelain=v1", "--untracked-files=all"]],
    ["git", ["fetch", "--quiet", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]],
    ["git", ["status", "--porcelain=v1", "--untracked-files=all"]],
    ["git", ["rev-parse", "--verify", "origin/main^{commit}"]],
    ["release", ["--source", source, "--confirm", "prod"]],
  ]);
});

test("dirty and local-only sources stop before the installed runtime", async () => {
  const dirty = makeDependencies({ dirty: true });
  const dirtyResult = await runProgram(["release"], dirty.dependencies);
  assert.equal(dirtyResult.exitCode, 3);
  assert.deepEqual(JSON.parse(dirtyResult.stdout), {
    status: "BLOCKED",
    source: null,
    reason: "working_tree_dirty",
  });
  assert.equal(dirty.calls.length, 1);

  const localOnly = makeDependencies({ fetchExitCode: 1 });
  const localOnlyResult = await runProgram(["release", "--source", source], localOnly.dependencies);
  assert.equal(localOnlyResult.exitCode, 3);
  assert.deepEqual(JSON.parse(localOnlyResult.stdout), {
    status: "BLOCKED",
    source,
    reason: "source_not_remote",
  });
  assert.equal(localOnly.calls.some((call) => call.command === "release"), false);
});

test("manual default and explicit-source entrypoints send the same commit to the same runtime", async () => {
  const manual = makeDependencies();
  const explicit = makeDependencies();
  const manualResult = await runProgram(["release"], manual.dependencies);
  const explicitResult = await runProgram(["release", "--source", source], explicit.dependencies);
  const invocation = (calls) => calls.find((call) => call.command === "release");
  assert.deepEqual(invocation(manual.calls), invocation(explicit.calls));
  assert.equal(manualResult.stdout, explicitResult.stdout);
  assert.equal(JSON.parse(manualResult.stdout).requestId, "same-request");
});
