import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapturedCommandRunner, CommandResult } from "./runtime-types.js";

const commitShaPattern = /^[0-9a-f]{40}$/;
const remote = "https://github.com/fonte-is/fonte-core.git";
const executor = ".github/scripts/production-release-direct.mjs";

export async function runReleaseCommand(
  explicitSource: string,
  _cwd: string,
  runner: CapturedCommandRunner,
): Promise<CommandResult> {
  if (!commitShaPattern.test(explicitSource)) return blocked("source_sha_invalid", explicitSource);
  const root = mkdtempSync(join(tmpdir(), "fonte-release-tooling-"));
  try {
    const run = (command: string, args: string[]) => runner.run(command, args, root);
    if ((await run("git", ["init", "--quiet"])).exitCode !== 0
      || (await run("git", ["remote", "add", "origin", remote])).exitCode !== 0
      || (await run("git", ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", "main"])).exitCode !== 0) {
      return blocked("direct_executor_unavailable", explicitSource);
    }
    const main = await run("git", ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
    const revision = main.stdout.trim();
    if (main.exitCode !== 0 || !commitShaPattern.test(revision)
      || (await run("git", ["checkout", "--quiet", "--detach", revision])).exitCode !== 0) {
      return blocked("direct_executor_unavailable", explicitSource);
    }
    const installed = await run("git", ["cat-file", "-e", `HEAD:${executor}`]);
    if (installed.exitCode !== 0) return blocked("direct_executor_unavailable", explicitSource);
    const fetched = await run("git", ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", explicitSource]);
    if (fetched.exitCode !== 0) return blocked("source_not_remote", explicitSource);
    const resolved = await run("git", ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
    if (resolved.exitCode !== 0 || resolved.stdout.trim() !== explicitSource) {
      return blocked("source_not_remote", explicitSource);
    }
    const status = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.exitCode !== 0 || status.stdout.trim()) return blocked("direct_executor_unavailable", explicitSource);
    const result = await run(process.execPath, [join(root, executor), "--source", explicitSource]);
    return { exitCode: result.exitCode === 0 ? 0 : result.exitCode === 2 || result.exitCode === 3
      ? result.exitCode : 1, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function blocked(reason: string, source: string): CommandResult {
  return { exitCode: 3, stdout: `${JSON.stringify({ status: "BLOCKED", source, reason })}\n`, stderr: "" };
}
