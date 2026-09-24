import assert from "node:assert/strict";
import test from "node:test";
import { runReleaseCommand } from "../dist/release-command.js";

const source = "a".repeat(40);

test("release invokes the checked-in Core direct executor without PATH release lookup", async () => {
  const calls = [];
  const runner = {
    async run(command, args, cwd) {
      calls.push({ command, args: [...args], cwd });
      if (command === "git" && args[0] === "status") return { exitCode: 0, stdout: "", stderr: "" };
      if (command === "git" && args[0] === "fetch") return { exitCode: 0, stdout: "", stderr: "" };
      if (command === "git" && args[0] === "rev-parse") return { exitCode: 0, stdout: `${source}\n`, stderr: "" };
      if (command === "git" && args[0] === "cat-file") return { exitCode: 0, stdout: "", stderr: "" };
      if (command === process.execPath) return { exitCode: 0, stdout: "release_status=VERIFIED\n", stderr: "" };
      return { exitCode: 127, stdout: "", stderr: "unexpected executable" };
    },
  };

  const result = await runReleaseCommand(source, "/checkout/fonte-core", runner);
  assert.equal(result.exitCode, 0);
  const execution = calls.at(-1);
  assert.equal(execution.command, process.execPath);
  assert.deepEqual(execution.args, [
    "/checkout/fonte-core/.github/scripts/production-release-direct.mjs",
    "--source",
    source,
  ]);
  assert.equal(calls.some(({ command }) => command === "release"), false);
});

test("release refuses to execute when the direct Core executor is absent", async () => {
  const runner = {
    async run(command, args) {
      if (command === "git" && args[0] === "rev-parse") return { exitCode: 0, stdout: `${source}\n`, stderr: "" };
      if (command === "git" && args[0] === "cat-file") return { exitCode: 1, stdout: "", stderr: "missing" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  const result = await runReleaseCommand(source, "/checkout/fonte-core", runner);
  assert.equal(result.exitCode, 3);
  assert.match(result.stdout, /direct_executor_unavailable/u);
});
