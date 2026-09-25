import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapturedCommandRunner, CommandResult } from "./runtime-types.js";

const commitShaPattern = /^[0-9a-f]{40}$/;
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const toolingIdentity = JSON.parse(readFileSync(join(packageRoot, "assets", "release-tooling.json"),
  "utf8")) as { schemaVersion: string; remote: string; revision: string; executor: string };
if (toolingIdentity.schemaVersion !== "fonte_cli_release_tooling_v1"
  || toolingIdentity.remote !== "https://github.com/fonte-is/fonte-core.git"
  || !commitShaPattern.test(toolingIdentity.revision)
  || toolingIdentity.executor !== ".github/scripts/production-release-direct.mjs") {
  throw new Error("release_tooling_identity_invalid");
}
const toolingRoot = join(packageRoot, "release-tooling", toolingIdentity.revision);
const installedExecutor = join(toolingRoot, toolingIdentity.executor);

export function installedReleaseExecutorPath(): string { return installedExecutor; }

export async function runReleaseCommand(
  explicitSource: string,
  _cwd: string,
  runner: CapturedCommandRunner,
): Promise<CommandResult> {
  if (!commitShaPattern.test(explicitSource)) return blocked("source_sha_invalid", explicitSource);

  // The installation owns this pinned Core checkout. Operator cwd is never an
  // executor location; the requested remote SHA is fetched into this checkout.
  const revision = await runner.run("git", ["rev-parse", "--verify", "HEAD^{commit}"], toolingRoot);
  if (revision.exitCode !== 0 || revision.stdout.trim() !== toolingIdentity.revision) {
    return blocked("direct_executor_unavailable", explicitSource);
  }
  const remote = await runner.run("git", ["remote", "get-url", "origin"], toolingRoot);
  if (remote.exitCode !== 0 || remote.stdout.trim() !== toolingIdentity.remote) {
    return blocked("direct_executor_unavailable", explicitSource);
  }
  const status = await runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], toolingRoot);
  if (status.exitCode !== 0 || status.stdout.trim()) {
    return blocked("direct_executor_unavailable", explicitSource);
  }
  const installed = await runner.run("git", ["cat-file", "-e", `HEAD:${toolingIdentity.executor}`], toolingRoot);
  if (installed.exitCode !== 0) return blocked("direct_executor_unavailable", explicitSource);

  const fetched = await runner.run(
    "git",
    ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", explicitSource],
    toolingRoot,
  );
  if (fetched.exitCode !== 0) return blocked("source_not_remote", explicitSource);

  const resolved = await runner.run(
    "git",
    ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
    toolingRoot,
  );
  const sha = resolved.stdout.trim();
  if (resolved.exitCode !== 0 || sha !== explicitSource) {
    return blocked("source_not_remote", explicitSource);
  }

  return runner.run(process.execPath, [installedExecutor, "--source", sha], toolingRoot).then((result) => ({
    exitCode: result.exitCode === 0 ? 0 : result.exitCode === 2 || result.exitCode === 3 ? result.exitCode : 1,
    stdout: result.stdout,
    stderr: result.stderr,
  }));
}

function blocked(reason: string, source: string): CommandResult {
  return {
    exitCode: 3,
    stdout: `${JSON.stringify({ status: "BLOCKED", source, reason })}\n`,
    stderr: "",
  };
}
