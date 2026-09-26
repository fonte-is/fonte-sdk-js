import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runReleaseCommand } from "../dist/release-command.js";

const source = "a".repeat(40);
const main = "b".repeat(40);
const cacheHome = mkdtempSync(join(tmpdir(), "fonte-release-cache-test-"));
const priorCacheHome = process.env.XDG_CACHE_HOME;
process.env.XDG_CACHE_HOME = cacheHome;
test.after(() => {
  rmSync(cacheHome, { recursive: true, force: true });
  if (priorCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = priorCacheHome;
});

function releaseRunner({ executor = true, remoteSource = true } = {}) {
  const calls = [];
  return {
    calls,
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
      if (command === "git" && args[0] === "rev-parse") {
        const sourceCheckout = cwd.endsWith("/source");
        const sourceFetch = calls.some(
          (call) =>
            call.command === "git" &&
            call.cwd === cwd &&
            call.args[0] === "fetch" &&
            call.args.at(-1) === source,
        );
        const sha =
          sourceCheckout || (args[2] === "FETCH_HEAD^{commit}" && sourceFetch)
            ? source
            : main;
        return { exitCode: 0, stdout: `${sha}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "cat-file") {
        return { exitCode: executor ? 0 : 1, stdout: "", stderr: "" };
      }
      if (
        command === "git" &&
        args[0] === "fetch" &&
        args.at(-1) === source &&
        !remoteSource
      ) {
        return { exitCode: 1, stdout: "", stderr: "source missing" };
      }
      if (command === process.execPath) {
        return { exitCode: 0, stdout: "release_status=VERIFIED\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

test("Core and umbrella invocations use the current canonical release engine without an SDK SHA pin", async () => {
  for (const location of [
    "/checkout/fonte-core",
    "/checkout/fonte-repos",
    "/private/tmp/other",
  ]) {
    const runner = releaseRunner();
    const result = await runReleaseCommand(source, location, runner);
    assert.equal(result.exitCode, 0, location);
    const roots = new Set(runner.calls.map((call) => call.cwd));
    assert.equal(roots.size, 2);
    assert.equal(roots.has(location), false);
    assert.deepEqual(
      runner.calls
        .filter((call) => call.command === "git" && call.args[0] === "fetch")
        .map((call) => call.args.at(-1)),
      ["main", source],
    );
    assert.deepEqual(
      runner.calls.find(
        (call) => call.command === "git" && call.args[0] === "checkout",
      )?.args,
      ["checkout", "--quiet", "--detach", main],
    );
    const invocation = runner.calls.at(-1);
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(invocation.args, [
      join(
        [...roots].find((root) => root.endsWith("/tooling")),
        ".github/scripts/production-release-direct.mjs",
      ),
      "--source",
      source,
      "--source-root",
      invocation.cwd,
    ]);
    assert.equal(invocation.cwd.endsWith("/source"), true);
  }
});

test("fresh CLI process waits for one local executor across artifact states and forwards its final result", () => {
  const directory = mkdtempSync(join(tmpdir(), "fonte-cli-release-test-"));
  try {
    const upstream = join(directory, "upstream.git");
    const seed = join(directory, "seed");
    mkdirSync(seed);
    const git = (cwd, ...args) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(directory, "init", "--quiet", "--bare", upstream);
    git(seed, "init", "--quiet");
    writeFileSync(
      join(seed, "application.txt"),
      "synthetic application source\n",
    );
    git(seed, "add", "application.txt");
    git(
      seed,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--quiet",
      "-m",
      "source",
    );
    const applicationSource = git(seed, "rev-parse", "HEAD");
    const scripts = join(seed, ".github", "scripts");
    mkdirSync(scripts, { recursive: true });
    writeFileSync(
      join(scripts, "production-release-direct.mjs"),
      `import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
const source = args[args.indexOf("--source") + 1];
const root = args[args.indexOf("--source-root") + 1];
const git = (cwd, ...parts) => execFileSync("git", parts, { cwd, encoding: "utf8" }).trim();
const tooling = fileURLToPath(new URL("../..", import.meta.url));
if (source !== process.env.FONTE_TEST_SOURCE || realpathSync(root) !== process.cwd()
  || git(root, "rev-parse", "HEAD") !== source
  || git(root, "rev-parse", "FETCH_HEAD^{commit}") !== source
  || git(tooling, "rev-parse", "HEAD") !== process.env.FONTE_TEST_MAIN) process.exit(2);
if (process.env.FONTE_TEST_SCENARIO === "running" || process.env.FONTE_TEST_SCENARIO === "missing")
  await new Promise(done => setTimeout(done, 120));
if (process.env.FONTE_TEST_SCENARIO === "failed") {
  process.stderr.write("release_artifact:qualification_failed\\n");
  process.exit(3);
}
process.stdout.write("release_phase=" + (process.env.FONTE_TEST_SCENARIO === "existing" ? "artifact_reused"
  : process.env.FONTE_TEST_SCENARIO === "running" ? "build_followed" : "build_started_and_followed") + "\\n");
process.stdout.write("release_status=VERIFIED source=" + source + "\\n");
`,
    );
    git(seed, "add", ".github/scripts/production-release-direct.mjs");
    git(
      seed,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--quiet",
      "-m",
      "executor",
    );
    const toolingSource = git(seed, "rev-parse", "HEAD");
    git(seed, "branch", "-M", "main");
    git(seed, "remote", "add", "origin", upstream);
    git(seed, "push", "--quiet", "origin", "main");
    for (const scenario of ["existing", "running", "missing", "failed"]) {
      const started = Date.now();
      const result = spawnSync(
        process.execPath,
        [
          new URL("../dist/main.js", import.meta.url).pathname,
          "release",
          "--source",
          applicationSource,
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: `url.file://${upstream}/.insteadOf`,
            GIT_CONFIG_VALUE_0: "https://github.com/fonte-is/fonte-core.git",
            FONTE_TEST_SOURCE: applicationSource,
            FONTE_TEST_MAIN: toolingSource,
            FONTE_TEST_SCENARIO: scenario,
          },
        },
      );
      assert.equal(
        result.status,
        scenario === "failed" ? 3 : 0,
        result.stderr || result.stdout,
      );
      if (scenario === "failed")
        assert.match(result.stderr, /release_artifact:qualification_failed/u);
      else {
        assert.match(result.stdout, /release_status=VERIFIED/u);
        assert.match(
          result.stdout,
          new RegExp(
            `release_phase=${
              {
                existing: "artifact_reused",
                running: "build_followed",
                missing: "build_started_and_followed",
              }[scenario]
            }`,
            "u",
          ),
        );
      }
      if (scenario === "running" || scenario === "missing")
        assert.ok(Date.now() - started >= 120);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing current executor or unresolvable source blocks before release effects", async () => {
  for (const [options, reason] of [
    [{ executor: false }, "direct_executor_unavailable"],
    [{ remoteSource: false }, "source_not_remote"],
  ]) {
    const runner = releaseRunner(options);
    const result = await runReleaseCommand(source, "/checkout", runner);
    assert.equal(result.exitCode, 3);
    assert.match(result.stdout, new RegExp(reason, "u"));
    assert.equal(
      runner.calls.some((call) => call.command === process.execPath),
      false,
    );
  }
});
