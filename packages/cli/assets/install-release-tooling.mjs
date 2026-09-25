import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.FONTE_INSTALL_RELEASE_TOOLING === "1") {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const identity = JSON.parse(readFileSync(new URL("release-tooling.json", import.meta.url), "utf8"));
  assert.equal(identity.schemaVersion, "fonte_cli_release_tooling_v1");
  assert.match(identity.revision, /^[0-9a-f]{40}$/u);
  assert.equal(identity.remote, "https://github.com/fonte-is/fonte-core.git");
  assert.equal(identity.executor, ".github/scripts/production-release-direct.mjs");
  const installed = join(packageRoot, "release-tooling", identity.revision);
  const temporary = `${installed}.install-${process.pid}`;
  const run = (binary, args, cwd) => execFileSync(binary, args, { cwd, stdio: "inherit" });
  if (!existsSync(installed)) {
    mkdirSync(dirname(installed), { recursive: true });
    rmSync(temporary, { recursive: true, force: true });
    try {
      run("git", ["init", "--quiet", temporary], packageRoot);
      run("git", ["remote", "add", "origin", identity.remote], temporary);
      run("git", ["fetch", "--quiet", "--no-tags", "--depth=2", "origin", identity.revision], temporary);
      run("git", ["checkout", "--quiet", "--detach", identity.revision], temporary);
      run("npm", ["ci", "--no-audit", "--no-fund"], temporary);
      run("npm", ["run", "build"], temporary);
      assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: temporary, encoding: "utf8" }).trim(),
        identity.revision);
      assert.equal(execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"],
        { cwd: temporary, encoding: "utf8" }).trim(), "");
      assert.ok(existsSync(join(temporary, identity.executor)));
      renameSync(temporary, installed);
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  process.stdout.write(`installed_release_executor=${join(installed, identity.executor)}\n`);
}
