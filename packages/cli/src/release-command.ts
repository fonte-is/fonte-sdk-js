import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CapturedCommandRunner,
  CommandOutput,
  CommandResult,
} from "./runtime-types.js";

const commitShaPattern = /^[0-9a-f]{40}$/;
const remote = "https://github.com/fonte-is/fonte-core.git";
const executor = ".github/scripts/production-release-direct.mjs";

// Only immutable Git objects and shallow boundaries are shared. Each invocation
// owns its refs, config, FETCH_HEAD, index and checkouts, including during fetches.
function objectCache(): string | undefined {
  try {
    const cache = join(
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
      "fonte",
      "release-git-v1",
    );
    mkdirSync(join(cache, "objects"), { recursive: true, mode: 0o700 });
    mkdirSync(join(cache, "shallow"), { recursive: true, mode: 0o700 });
    return realpathSync(cache);
  } catch {
    return undefined; // An unavailable cache must never prevent a release.
  }
}

function attachObjects(tooling: string, cache: string): boolean {
  const objects = join(cache, "objects");
  if (
    !readdirSync(objects).some(
      (name) =>
        /^(?:[0-9a-f]{2}|pack)$/.test(name) &&
        readdirSync(join(objects, name)).length,
    )
  )
    return false;
  writeFileSync(
    join(tooling, ".git", "objects", "info", "alternates"),
    `${join(cache, "objects")}\n`,
  );
  const shallow = new Set<string>();
  for (const name of readdirSync(join(cache, "shallow"))) {
    if (!commitShaPattern.test(name)) continue;
    for (const sha of readFileSync(join(cache, "shallow", name), "utf8")
      .trim()
      .split("\n")) {
      if (commitShaPattern.test(sha)) shallow.add(sha);
    }
  }
  if (shallow.size)
    writeFileSync(
      join(tooling, ".git", "shallow"),
      `${[...shallow].join("\n")}\n`,
    );
  return true;
}

function publishObjects(
  tooling: string,
  cache: string,
  source: string,
  revision: string,
): void {
  try {
    const objects = join(tooling, ".git", "objects");
    for (const directory of readdirSync(objects)) {
      if (!/^(?:[0-9a-f]{2}|pack)$/.test(directory)) continue;
      const destination = join(cache, "objects", directory);
      mkdirSync(destination, { recursive: true, mode: 0o700 });
      for (const name of readdirSync(join(objects, directory))) {
        if (
          !/^(?:[0-9a-f]{38}|pack-[0-9a-f]{40}\.(?:pack|idx|rev))$/.test(name)
        )
          continue;
        const target = join(destination, name);
        // Rename complete files atomically; concurrent writers publish identical
        // content-addressed objects without sharing a lock or mutable Git state.
        const temporary = `${target}.${randomUUID()}.tmp`;
        copyFileSync(join(objects, directory, name), temporary);
        renameSync(temporary, target);
      }
    }
    const shallow = join(tooling, ".git", "shallow");
    if (existsSync(shallow)) {
      const target = join(cache, "shallow", source);
      const temporary = `${target}.${randomUUID()}.tmp`;
      copyFileSync(shallow, temporary);
      renameSync(temporary, target);
    }
    const tip = join(cache, "tooling-tip");
    const temporary = `${tip}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${revision}\n`, { mode: 0o600 });
    renameSync(temporary, tip);
  } catch {
    // Cache population is best-effort; a successful verified checkout is enough.
  }
}

export async function runReleaseCommand(
  explicitSource: string,
  _cwd: string,
  runner: CapturedCommandRunner,
  output?: CommandOutput,
): Promise<CommandResult> {
  if (!commitShaPattern.test(explicitSource))
    return blocked("source_sha_invalid", explicitSource);
  return releaseFromRemote(explicitSource, runner, objectCache(), output);
}

async function releaseFromRemote(
  explicitSource: string,
  runner: CapturedCommandRunner,
  cache: string | undefined,
  output?: CommandOutput,
): Promise<CommandResult> {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "fonte-release-tooling-")),
  );
  const tooling = join(root, "tooling");
  const source = join(root, "source");
  try {
    mkdirSync(tooling);
    const run = (command: string, args: string[], cwd = tooling) =>
      runner.run(command, args, cwd);
    const negotiation: string[] = [];
    let cachedObjectsAttached = false;
    if (
      (await run("git", ["init", "--quiet"])).exitCode !== 0 ||
      (await run("git", ["remote", "add", "origin", remote])).exitCode !== 0
    ) {
      return blocked("direct_executor_unavailable", explicitSource);
    }
    if (cache) {
      try {
        // Discard damaged cached objects before contacting the remote. Cache
        // corruption must cost a cold fetch, never prevent a valid release.
        const attached = attachObjects(tooling, cache);
        cachedObjectsAttached = attached;
        if (
          attached &&
          (await run("git", ["fsck", "--full", "--no-dangling"])).exitCode !== 0
        )
          return releaseFromRemote(explicitSource, runner, undefined, output);
        // This is only a hint about locally available objects. The remote main
        // ref is still fetched and resolved afresh, regardless of this value.
        const tipFile = join(cache, "tooling-tip");
        if (existsSync(tipFile)) {
          const tip = readFileSync(tipFile, "utf8").trim();
          if (
            commitShaPattern.test(tip) &&
            (await run("git", ["cat-file", "-e", `${tip}^{commit}`]))
              .exitCode === 0
          )
            negotiation.push(`--negotiation-tip=${tip}`);
        }
      } catch {
        return releaseFromRemote(explicitSource, runner, undefined, output);
      }
    }
    if (
      (
        await run("git", [
          "fetch",
          "--quiet",
          "--no-tags",
          "--depth=2",
          ...negotiation,
          "origin",
          "main",
        ])
      ).exitCode !== 0
    ) {
      return blocked("direct_executor_unavailable", explicitSource);
    }
    const main = await run("git", [
      "rev-parse",
      "--verify",
      "FETCH_HEAD^{commit}",
    ]);
    const revision = main.stdout.trim();
    if (
      main.exitCode !== 0 ||
      !commitShaPattern.test(revision) ||
      (await run("git", ["checkout", "--quiet", "--detach", revision]))
        .exitCode !== 0
    ) {
      return blocked("direct_executor_unavailable", explicitSource);
    }
    const toolingHead = await run("git", [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
    if (toolingHead.exitCode !== 0 || toolingHead.stdout.trim() !== revision) {
      return blocked("direct_executor_unavailable", explicitSource);
    }
    const installed = await run("git", ["cat-file", "-e", `HEAD:${executor}`]);
    if (installed.exitCode !== 0)
      return blocked("direct_executor_unavailable", explicitSource);
    const fetched = await run("git", [
      "fetch",
      "--quiet",
      "--no-tags",
      // Cached objects may appear concurrently, so attached alternates always
      // require an explicit upstream object request. A fully cold invocation
      // can use normal negotiation against its freshly fetched main objects.
      ...(cachedObjectsAttached ? ["--refetch"] : []),
      "--depth=2",
      "origin",
      explicitSource,
    ]);
    if (fetched.exitCode !== 0)
      return blocked("source_not_remote", explicitSource);
    const resolved = await run("git", [
      "rev-parse",
      "--verify",
      "FETCH_HEAD^{commit}",
    ]);
    if (resolved.exitCode !== 0 || resolved.stdout.trim() !== explicitSource) {
      return blocked("source_not_remote", explicitSource);
    }
    if (cache) publishObjects(tooling, cache, explicitSource, revision);
    if (
      (
        await run("git", [
          "worktree",
          "add",
          "--detach",
          source,
          explicitSource,
        ])
      ).exitCode !== 0
    ) {
      return blocked("source_checkout_unavailable", explicitSource);
    }
    // FETCH_HEAD is private to each Git worktree. Preserve the exact, freshly
    // verified upstream fetch receipt without downloading the source again.
    copyFileSync(
      join(tooling, ".git", "FETCH_HEAD"),
      join(tooling, ".git", "worktrees", "source", "FETCH_HEAD"),
    );
    const sourceHead = await run(
      "git",
      ["rev-parse", "--verify", "HEAD^{commit}"],
      source,
    );
    const status = await run(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      source,
    );
    if (
      sourceHead.exitCode !== 0 ||
      sourceHead.stdout.trim() !== explicitSource ||
      status.exitCode !== 0 ||
      status.stdout.trim()
    ) {
      return blocked("source_checkout_unavailable", explicitSource);
    }
    // Git output remains captured for source verification. Only the executor's
    // existing output is forwarded, with its stdout/stderr channels unchanged.
    const result = await runner.run(
      process.execPath,
      [
        join(tooling, executor),
        "--source",
        explicitSource,
        "--source-root",
        source,
      ],
      source,
      output,
    );
    return {
      exitCode:
        result.exitCode === 0
          ? 0
          : result.exitCode === 2 || result.exitCode === 3
            ? result.exitCode
            : 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function blocked(reason: string, source: string): CommandResult {
  return {
    exitCode: 3,
    stdout: `${JSON.stringify({ status: "BLOCKED", source, reason })}\n`,
    stderr: "",
  };
}
