import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { CliBlockedError } from "./errors.js";
import type { ProjectProfile } from "./runtime-types.js";

const foreignLocks = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
const layoutNames = ["layout.js", "layout.jsx", "layout.ts", "layout.tsx"];

const exists = async (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** Detect only the npm + Next.js App Router profile declared in CONTRACT.md. */
export async function detectProject(root: string): Promise<ProjectProfile> {
  const canonicalRoot = await realpath(root).catch(() => {
    throw new CliBlockedError("project_manifest_invalid");
  });
  const packageManifest = await readFile(
    path.join(canonicalRoot, "package.json"),
    "utf8",
  )
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => {
      throw new CliBlockedError("project_manifest_invalid");
    });
  if (
    !packageManifest ||
    typeof packageManifest !== "object" ||
    Array.isArray(packageManifest)
  ) {
    throw new CliBlockedError("project_manifest_invalid");
  }
  const input = packageManifest as Record<string, unknown>;
  const manager = input.packageManager;
  const foreignLockPresent = (
    await Promise.all(
      foreignLocks.map((name) => exists(path.join(canonicalRoot, name))),
    )
  ).some(Boolean);
  if (
    foreignLockPresent ||
    (manager !== undefined &&
      (typeof manager !== "string" || !manager.startsWith("npm@")))
  ) {
    throw new CliBlockedError("unsupported_package_manager");
  }
  const layouts = (
    await Promise.all(
      (["app", "src/app"] as const).flatMap((directory) =>
        layoutNames.map(async (name) => ({
          directory,
          present: await exists(path.join(canonicalRoot, directory, name)),
        })),
      ),
    )
  ).filter(({ present }) => present);
  if (layouts.length === 0) throw new CliBlockedError("unsupported_framework");
  if (layouts.length !== 1) {
    throw new CliBlockedError("ambiguous_app_router_root");
  }
  const scripts = input.scripts;
  const normalizedScripts =
    scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? Object.fromEntries(
          Object.entries(scripts).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    root: canonicalRoot,
    app_directory: layouts[0]!.directory,
    package_manager: "npm",
    package_manifest: input,
    scripts: normalizedScripts,
  };
}
