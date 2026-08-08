import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const packageOrder = ["core", "react", "nextjs"];
export const packageNames = packageOrder.map((name) => `@fonte-is/${name}`);

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stdout = result.stdout ? `\nstdout:\n${result.stdout}` : "";
    const stderr = result.stderr ? `\nstderr:\n${result.stderr}` : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}${stdout}${stderr}`,
    );
  }
  return result.stdout ?? "";
}

export function ensureWorkspaceLinks() {
  const scope = join(root, "node_modules", "@fonte-is");
  mkdirSync(scope, { recursive: true });
  for (const name of packageOrder) {
    const target = join(root, "packages", name);
    const link = join(scope, name);
    if (existsSync(link)) continue;
    symlinkSync(target, link, "dir");
  }
}

export function resetDirectory(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}
