import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { CliBlockedError } from "./errors.js";

const forbiddenSegments = new Set([".git", "node_modules"]);

export function resolveManagedPath(root: string, relativePath: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    throw new CliBlockedError("managed_path_unsafe");
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        forbiddenSegments.has(segment),
    )
  ) {
    throw new CliBlockedError("managed_path_unsafe");
  }
  const target = path.resolve(root, ...segments);
  const relation = path.relative(root, target);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new CliBlockedError("managed_path_unsafe");
  }
  return target;
}

export async function assertManagedPathSafe(
  root: string,
  relativePath: string,
): Promise<string> {
  const canonicalRoot = await realpath(root);
  const target = resolveManagedPath(canonicalRoot, relativePath);
  let current = canonicalRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!entry) break;
    if (entry.isSymbolicLink()) {
      throw new CliBlockedError("managed_path_unsafe");
    }
  }
  return target;
}
