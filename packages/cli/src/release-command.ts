import type { CapturedCommandRunner, CommandResult } from "./runtime-types.js";

const commitShaPattern = /^[0-9a-f]{40}$/;

export async function runReleaseCommand(
  explicitSource: string,
  cwd: string,
  runner: CapturedCommandRunner,
): Promise<CommandResult> {
  if (!commitShaPattern.test(explicitSource)) return blocked("source_sha_invalid", explicitSource);

  const status = await runner.run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd,
  );
  if (status.exitCode !== 0) return blocked("git_status_unavailable", explicitSource);
  if (status.stdout.length > 0) return blocked("working_tree_dirty", explicitSource);

  const fetched = await runner.run(
    "git",
    ["fetch", "--quiet", "--no-tags", "origin", explicitSource],
    cwd,
  );
  if (fetched.exitCode !== 0) return blocked("source_not_remote", explicitSource);

  const resolved = await runner.run(
    "git",
    ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
    cwd,
  );
  const sha = resolved.stdout.trim();
  if (resolved.exitCode !== 0 || sha !== explicitSource) {
    return blocked("source_not_remote", explicitSource);
  }

  return runner.run("release", ["--source", sha], cwd).then((result) => ({
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
