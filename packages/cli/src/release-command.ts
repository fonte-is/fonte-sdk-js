import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  explicitSource: string | undefined,
  cwd: string,
  runner: CapturedCommandRunner,
): Promise<CommandResult> {
  let source = explicitSource;
  if (source === undefined) {
    const remote = await runner.run("git", ["remote", "get-url", "origin"], cwd);
    if (remote.exitCode !== 0 || ![
      toolingIdentity.remote,
      "git@github.com:fonte-is/fonte-core.git",
      "ssh://git@github.com/fonte-is/fonte-core.git",
    ].includes(remote.stdout.trim())) return blocked("source_not_core_checkout", "unknown");
    const status = await runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], cwd);
    if (status.exitCode !== 0 || status.stdout.trim()) return blocked("source_checkout_dirty", "unknown");
    const head = await runner.run("git", ["rev-parse", "--verify", "HEAD^{commit}"], cwd);
    source = head.stdout.trim();
    if (head.exitCode !== 0 || !commitShaPattern.test(source)) return blocked("source_sha_invalid", "unknown");
  }
  if (!commitShaPattern.test(source)) return blocked("source_sha_invalid", source);

  // The installation owns this pinned Core checkout. Operator cwd is never an
  // executor location; the requested remote SHA is fetched into this checkout.
  const revision = await runner.run("git", ["rev-parse", "--verify", "HEAD^{commit}"], toolingRoot);
  if (revision.exitCode !== 0 || revision.stdout.trim() !== toolingIdentity.revision) {
    return blocked("direct_executor_unavailable", source);
  }
  const remote = await runner.run("git", ["remote", "get-url", "origin"], toolingRoot);
  if (remote.exitCode !== 0 || remote.stdout.trim() !== toolingIdentity.remote) {
    return blocked("direct_executor_unavailable", source);
  }
  const status = await runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], toolingRoot);
  if (status.exitCode !== 0 || status.stdout.trim()) {
    return blocked("direct_executor_unavailable", source);
  }
  const installed = await runner.run("git", ["cat-file", "-e", `HEAD:${toolingIdentity.executor}`], toolingRoot);
  if (installed.exitCode !== 0) return blocked("direct_executor_unavailable", source);

  const fetched = await runner.run(
    "git",
    ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", source],
    toolingRoot,
  );
  if (fetched.exitCode !== 0) return blocked("source_not_remote", source);

  const resolved = await runner.run(
    "git",
    ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
    toolingRoot,
  );
  const sha = resolved.stdout.trim();
  if (resolved.exitCode !== 0 || sha !== source) {
    return blocked("source_not_remote", source);
  }

  const checkout = mkdtempSync(join(tmpdir(), "fonte-release-source-"));
  try {
    const added = await runner.run("git", ["worktree", "add", "--detach", checkout, sha], toolingRoot);
    if (added.exitCode !== 0) return blocked("source_checkout_unavailable", sha);
    const checkoutFetch = await runner.run("git", ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", sha], checkout);
    if (checkoutFetch.exitCode !== 0) return blocked("source_not_remote", sha);
    const checkoutHead = await runner.run("git", ["rev-parse", "--verify", "HEAD^{commit}"], checkout);
    const checkoutRemote = await runner.run("git", ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], checkout);
    const checkoutStatus = await runner.run("git", ["status", "--porcelain=v1", "--untracked-files=all"], checkout);
    if (checkoutHead.exitCode !== 0 || checkoutHead.stdout.trim() !== sha
      || checkoutRemote.exitCode !== 0 || checkoutRemote.stdout.trim() !== sha
      || checkoutStatus.exitCode !== 0 || checkoutStatus.stdout.trim()) {
      return blocked("source_checkout_unavailable", sha);
    }
    const result = await runner.run(process.execPath, [installedExecutor, "--source", sha], checkout);
    return {
      exitCode: result.exitCode === 0 ? 0 : result.exitCode === 2 || result.exitCode === 3 ? result.exitCode : 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await runner.run("git", ["worktree", "remove", "--force", checkout], toolingRoot);
    rmSync(checkout, { recursive: true, force: true });
  }
}

function blocked(reason: string, source: string): CommandResult {
  return {
    exitCode: 3,
    stdout: `${JSON.stringify({ status: "BLOCKED", source, reason })}\n`,
    stderr: "",
  };
}
