import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { RELEASE_HELP_TEXT } from "../packages/cli/dist/constants.js";
import { runProgram } from "../packages/cli/dist/program.js";

const source = "a".repeat(40);
const main = "b".repeat(40);
const runtimeResult = {
  exitCode: 0,
  stdout: `{"status":"VERIFIED","source":"${source}"}\n`,
  stderr: "",
};
const cacheHome = mkdtempSync(join(tmpdir(), "fonte-release-program-test-"));
const priorCacheHome = process.env.XDG_CACHE_HOME;
process.env.XDG_CACHE_HOME = cacheHome;
test.after(() => {
  rmSync(cacheHome, { recursive: true, force: true });
  if (priorCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = priorCacheHome;
});

function dependencies(options = {}) {
  const calls = [];
  const releaseRunner = {
    async run(command, args, cwd) {
      calls.push({ command, args: [...args], cwd });
      if (command === "git" && args[0] === "init")
        mkdirSync(join(cwd, ".git", "objects", "info"), { recursive: true });
      if (command === "git" && args[0] === "fetch")
        writeFileSync(join(cwd, ".git", "FETCH_HEAD"), `${source}\n`);
      if (command === "git" && args[0] === "worktree")
        mkdirSync(join(cwd, ".git", "worktrees", "source"), {
          recursive: true,
        });
      if (command === process.execPath) return runtimeResult;
      if (command === "git" && args[0] === "status") {
        return {
          exitCode: 0,
          stdout: options.dirty ? " M file.ts\n" : "",
          stderr: "",
        };
      }
      if (command === "git" && args[0] === "fetch") {
        return {
          exitCode: options.fetchFailed && args.at(-1) === source ? 1 : 0,
          stdout: "",
          stderr: "",
        };
      }
      if (command === "git" && args[0] === "rev-parse") {
        const sourceCheckout = cwd.endsWith("/source");
        const fetchedSource = calls.some(
          (call) =>
            call.cwd === cwd &&
            call.args[0] === "fetch" &&
            call.args.at(-1) === source,
        );
        return {
          exitCode: 0,
          stdout: `${
            sourceCheckout ||
            (args[2] === "FETCH_HEAD^{commit}" && fetchedSource)
              ? (options.resolved ?? source)
              : main
          }\n`,
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
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
    command: "release",
    apply: false,
    json: false,
    releaseSource: source,
  });
  assert.equal(
    parseArguments(["release", "--help"]).helpText,
    RELEASE_HELP_TEXT,
  );
  for (const argv of [
    ["release"],
    ["release", "--source"],
    ["release", "--source", "local-branch"],
    ["release", "--source", source, "--target", "api"],
    ["release", "--source", source, "--confirm", "prod"],
  ])
    assert.throws(() => parseArguments(argv));
});

test("release hands the exact source to one Core executor", async () => {
  const setup = dependencies();
  const result = await runProgram(
    ["release", "--source", source],
    setup.dependencies,
  );
  assert.deepEqual(result, runtimeResult);
  const invocations = setup.calls.filter(
    (call) => call.command === process.execPath,
  );
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0].args.slice(1), [
    "--source",
    source,
    "--source-root",
    invocations[0].cwd,
  ]);
  assert.equal(
    invocations[0].args[0].endsWith(
      "/tooling/.github/scripts/production-release-direct.mjs",
    ),
    true,
  );
  assert.equal(invocations[0].cwd.endsWith("/source"), true);
});

test("release refuses a dirty, unpushed, or mismatched source checkout", async () => {
  for (const options of [
    { dirty: true },
    { fetchFailed: true },
    { resolved: "b".repeat(40) },
  ]) {
    const setup = dependencies(options);
    const result = await runProgram(
      ["release", "--source", source],
      setup.dependencies,
    );
    assert.equal(result.exitCode, 3);
    assert.equal(
      setup.calls.some((call) => call.command === process.execPath),
      false,
    );
  }
});
