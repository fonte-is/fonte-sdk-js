import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function syntheticReleaseRemote(directory, name = "upstream") {
  const upstream = join(directory, `${name}.git`);
  const seed = join(directory, `${name}-seed`);
  mkdirSync(seed);
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(directory, "init", "--quiet", "--bare", upstream);
  git(seed, "init", "--quiet");
  const commit = (message) => {
    git(seed, "add", ".");
    git(
      seed,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--quiet",
      "-m",
      message,
    );
    return git(seed, "rev-parse", "HEAD");
  };
  writeFileSync(join(seed, "synthetic-payload.bin"), randomBytes(256 * 1024));
  writeFileSync(join(seed, "application.txt"), `${name} old application\n`);
  const source = commit("application old");
  writeFileSync(join(seed, "application.txt"), `${name} new application\n`);
  const nextSource = commit("application new");
  const scripts = join(seed, ".github", "scripts");
  mkdirSync(scripts, { recursive: true });
  const executor = join(scripts, "production-release-direct.mjs");
  writeFileSync(
    executor,
    `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const source = args[args.indexOf('--source') + 1];
const root = args[args.indexOf('--source-root') + 1];
const git = (cwd, ...parts) => execFileSync('git', parts, { cwd, encoding: 'utf8' }).trim();
const tooling = fileURLToPath(new URL('../..', import.meta.url));
assert.equal(realpathSync(root), process.cwd());
assert.equal(source, process.env.FONTE_TEST_SOURCE);
assert.equal(git(root, 'rev-parse', 'HEAD^{commit}'), source);
assert.equal(git(root, 'rev-parse', 'FETCH_HEAD^{commit}'), source);
assert.equal(git(root, 'status', '--porcelain=v1'), '');
assert.equal(git(tooling, 'rev-parse', 'HEAD^{commit}'), process.env.FONTE_TEST_MAIN);
assert.equal(git(root, 'config', 'remote.origin.url'), 'https://github.com/fonte-is/fonte-core.git');
process.stdout.write('release_status=VERIFIED source=' + source + '\\n');
`,
  );
  let main = commit("canonical executor");
  git(seed, "branch", "-M", "main");
  git(seed, "remote", "add", "origin", upstream);
  git(seed, "push", "--quiet", "origin", "main");
  const environment = (
    application = source,
    cache = join(directory, "cache"),
    trace,
  ) => ({
    ...process.env,
    XDG_CACHE_HOME: cache,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.file://${upstream}/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/fonte-is/fonte-core.git",
    FONTE_TEST_SOURCE: application,
    FONTE_TEST_MAIN: main,
    ...(trace ? { GIT_TRACE: trace } : {}),
  });
  return {
    upstream,
    source,
    nextSource,
    environment,
    advanceMain() {
      writeFileSync(
        join(seed, "unrelated-tooling.txt"),
        "new canonical tooling\n",
      );
      main = commit("advance canonical tooling");
      git(seed, "push", "--quiet", "origin", "main");
      return main;
    },
  };
}
