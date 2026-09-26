import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { releaseRunner } from "../dist/runner.js";
import { syntheticReleaseRemote } from "./fixtures/release-git-remote.mjs";

const phase = `${JSON.stringify({ phase: "provider_readback" })}\n`;
const terminal = `${JSON.stringify({ status: "VERIFIED" })}\n`;

for (const [executorExit, expectedExit] of [
  [0, 0],
  [2, 2],
  [3, 3],
  [17, 1],
]) {
  test(
    `installed release streams before executor exit ${executorExit}, retaining exit ${expectedExit}`,
    { timeout: 30_000 },
    async (t) => {
      const directory = mkdtempSync(join(tmpdir(), "fonte-release-stream-"));
      let child;
      t.after(() => {
        child?.kill();
        rmSync(directory, { recursive: true, force: true });
      });
      const fixture = syntheticReleaseRemote(directory);
      const seed = join(directory, "upstream-seed");
      const executor = join(
        seed,
        ".github/scripts/production-release-direct.mjs",
      );
      const existing = readFileSync(executor, "utf8");
      // Preserve the fixture's exact source/checkout/tooling assertions. The
      // executor cannot finish until the test has observed its first output.
      writeFileSync(
        executor,
        existing.replace(
          "process.stdout.write('release_status=VERIFIED source=' + source + '\\n');",
          `
import { existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
process.stdout.write(${JSON.stringify(phase)});
process.stderr.write('release_phase=provider_readback\\n');
const deadline = Date.now() + 10_000;
while (!existsSync(process.env.FONTE_TEST_GATE + '/continue')) {
  assert.ok(Date.now() < deadline, 'test must acknowledge streamed phase before executor can finish');
  await setTimeout(10);
}
process.stdout.write(${JSON.stringify(terminal)});
process.stderr.write('release_executor_finished\\n');
process.exitCode = ${executorExit};
`,
        ),
      );
      const git = (...args) =>
        execFileSync("git", args, { cwd: seed, encoding: "utf8" }).trim();
      git("add", ".github/scripts/production-release-direct.mjs");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "commit",
        "--quiet",
        "-m",
        "gated executor",
      );
      git("push", "--quiet", "origin", "main");
      const main = new URL("../dist/main.js", import.meta.url).pathname;
      child = spawn(
        process.execPath,
        [main, "release", "--source", fixture.source],
        {
          cwd: directory,
          env: {
            ...fixture.environment(),
            FONTE_TEST_MAIN: git("rev-parse", "HEAD"),
            FONTE_TEST_GATE: directory,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const closed = once(child, "close");
      const firstPhase = new Promise((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          if (stdout.includes(phase)) resolve();
        });
        child.once("error", reject);
        child.once("close", () =>
          reject(Error("executor exited before streaming its phase")),
        );
      });
      const firstDiagnostic = new Promise((resolve, reject) => {
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
          if (stderr.includes("release_phase=provider_readback\n")) resolve();
        });
        child.once("error", reject);
        child.once("close", () =>
          reject(Error("executor exited before streaming its diagnostic")),
        );
      });
      await Promise.all([firstPhase, firstDiagnostic]);
      assert.equal(
        child.exitCode,
        null,
        "phase must arrive while executor remains active",
      );
      assert.equal(
        stdout,
        phase,
        "structured stdout must arrive unchanged before terminal output",
      );
      assert.equal(stderr, "release_phase=provider_readback\n");
      writeFileSync(join(directory, "continue"), "continue\n");
      const [exitCode] = await closed;
      assert.equal(exitCode, expectedExit, stderr);
      assert.equal(
        stdout,
        phase + terminal,
        "streamed output must not replay at completion",
      );
      assert.equal(
        stderr,
        "release_phase=provider_readback\nrelease_executor_finished\n",
      );
    },
  );
}

test("runner retains captured output without streaming and spawn errors still reject", async () => {
  const result = await releaseRunner.run(
    process.execPath,
    [
      "-e",
      "process.stdout.write('result');process.stderr.write('diagnostic');process.exitCode=3",
    ],
    tmpdir(),
  );
  assert.deepEqual(result, {
    exitCode: 3,
    stdout: "result",
    stderr: "diagnostic",
  });
  await assert.rejects(
    releaseRunner.run(
      join(tmpdir(), "fonte-nonexistent-executable"),
      [],
      tmpdir(),
    ),
    { code: "ENOENT" },
  );
});
