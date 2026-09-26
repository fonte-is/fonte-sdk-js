import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EXECUTION_ERROR_TEXT } from "../dist/constants.js";
import { CliUsageError } from "../dist/errors.js";
import { runProgram } from "../dist/program.js";
import { runReleaseProgram } from "../dist/release-program.js";
import { syntheticReleaseRemote } from "./fixtures/release-git-remote.mjs";

const source = "a".repeat(40);
const directory = mkdtempSync(join(tmpdir(), "fonte-release-entry-"));
const previousCache = process.env.XDG_CACHE_HOME;
process.env.XDG_CACHE_HOME = join(directory, "cache");
test.after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = previousCache;
});
const runner = {
  run: async () => {
    throw new Error("Unexpected release effect");
  },
};
const dependencies = {
  cwd: directory,
  randomUUID: () => "10000000-0000-4000-8000-000000000001",
  runner: { run: async () => 1 },
  releaseRunner: runner,
};

test("dedicated release help and invocation errors match the canonical public program", async () => {
  for (const argv of [
    ["release", "--help"],
    ["release"],
    ["release", "--source"],
    ["release", "--source", "main"],
    ["release", "--source", source, "--target", "api"],
    ["release", "--source", source, "--json"],
    ["release", "--json"],
    ["release", "--help", "--json"],
    ["release", "--source", "A".repeat(40)],
    ["release", "--source", source, "--source", source],
  ])
    assert.deepEqual(
      await runReleaseProgram(argv, directory, runner),
      await runProgram(argv, dependencies),
      argv.join(" "),
    );
});

test("release execution exceptions keep the generic execution error and exit code", async () => {
  for (const error of [
    new Error("Internal error details"),
    new CliUsageError("runtime_error"),
  ]) {
    const result = await runReleaseProgram(
      ["release", "--source", source],
      directory,
      {
        run: async () => {
          throw error;
        },
      },
    );
    assert.deepEqual(result, {
      exitCode: 1,
      stdout: "",
      stderr: EXECUTION_ERROR_TEXT,
    });
  }
});

test("fresh release processes load neither general CLI nor login, MCP or setup runtimes", () => {
  const fixture = syntheticReleaseRemote(directory);
  const main = new URL("../dist/main.js", import.meta.url).pathname;
  const loader = new URL("./fixtures/release-entry-loader.mjs", import.meta.url)
    .href;
  for (const argv of [
    ["release", "--help"],
    ["release", "--source", fixture.source],
    ["release", "--json"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-loader", loader, main, ...argv],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...fixture.environment(), NODE_NO_WARNINGS: "1" },
      },
    );
    assert.equal(
      result.status,
      argv.includes("--json") ? 2 : 0,
      result.stderr || result.stdout,
    );
    if (argv.includes("--source"))
      assert.match(result.stdout, /release_status=VERIFIED/u);
    else if (argv.includes("--json"))
      assert.equal(
        JSON.parse(result.stdout).schema_version,
        "fonte.cli.invalid_invocation.v1",
      );
    else assert.match(result.stdout, /--source/u);
  }
});

test("non-release invocations keep the general CLI rendering", async () => {
  const main = new URL("../dist/main.js", import.meta.url).pathname;
  for (const argv of [
    ["--version"],
    ["--help"],
    ["auth", "--help"],
    ["unknown", "--json"],
  ]) {
    const expected = await runProgram(argv, dependencies);
    const result = spawnSync(process.execPath, [main, ...argv], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, XDG_CACHE_HOME: join(directory, "general-cache") },
    });
    assert.deepEqual(
      { exitCode: result.status, stdout: result.stdout, stderr: result.stderr },
      {
        exitCode: expected.exitCode,
        stdout: expected.stdout,
        stderr: expected.stderr,
      },
      argv.join(" "),
    );
  }
});
