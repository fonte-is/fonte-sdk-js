import type { CapturedCommandRunner, CommandResult } from "./runtime-types.js";

const commitShaPattern = /^[0-9a-f]{40}$/;
const releaseRuntimeArguments = (source: string) => [
  "--source",
  source,
  "--confirm",
  "prod",
];

export async function runReleaseCommand(
  explicitSource: string | undefined,
  cwd: string,
  runner: CapturedCommandRunner,
): Promise<CommandResult> {
  const source = await resolveSource(explicitSource, cwd, runner);
  if ("blocked" in source) return source.blocked;

  const result = await runner.run(
    "release",
    releaseRuntimeArguments(source.sha),
    cwd,
  );
  return {
    exitCode: result.exitCode === 0 ? 0 : normalizeExitCode(result.exitCode),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function resolveSource(
  explicitSource: string | undefined,
  cwd: string,
  runner: CapturedCommandRunner,
): Promise<{ sha: string } | { blocked: CommandResult }> {
  const status = await runner.run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd,
  );
  if (status.exitCode !== 0) return blocked("git_status_unavailable", explicitSource);
  if (status.stdout.length > 0) return blocked("working_tree_dirty", explicitSource);

  const fetchArguments = explicitSource
    ? ["fetch", "--quiet", "--no-tags", "origin", explicitSource]
    : [
        "fetch",
        "--quiet",
        "--no-tags",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
      ];
  const fetched = await runner.run("git", fetchArguments, cwd);
  if (fetched.exitCode !== 0) {
    return blocked(explicitSource ? "source_not_remote" : "origin_main_fetch_failed", explicitSource);
  }

  const statusAfterFetch = await runner.run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd,
  );
  if (statusAfterFetch.exitCode !== 0) {
    return blocked("git_status_unavailable", explicitSource);
  }
  if (statusAfterFetch.stdout.length > 0) {
    return blocked("working_tree_dirty", explicitSource);
  }

  const reference = explicitSource ? "FETCH_HEAD^{commit}" : "origin/main^{commit}";
  const resolved = await runner.run("git", ["rev-parse", "--verify", reference], cwd);
  const sha = resolved.stdout.trim();
  if (resolved.exitCode !== 0 || !commitShaPattern.test(sha)) {
    return blocked(explicitSource ? "source_not_remote" : "origin_main_unavailable", explicitSource);
  }
  if (explicitSource && sha !== explicitSource) {
    return blocked("source_not_remote", explicitSource);
  }
  return { sha };
}

function blocked(reason: string, source: string | undefined): { blocked: CommandResult } {
  return {
    blocked: {
      exitCode: 3,
      stdout: `${JSON.stringify({ status: "BLOCKED", source: source ?? null, reason })}\n`,
      stderr: "",
    },
  };
}

function normalizeExitCode(exitCode: number): 1 | 2 | 3 {
  return exitCode === 2 || exitCode === 3 ? exitCode : 1;
}
