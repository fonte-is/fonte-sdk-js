import { rm } from "node:fs/promises";

const name = process.argv[2];
if (!["core", "react", "nextjs", "cli"].includes(name)) {
  throw new Error("Select a Fonte package to clean.");
}

// Removed modules must not survive into a later package from an earlier build.
await rm(new URL(`../packages/${name}/dist/`, import.meta.url), {
  recursive: true,
  force: true,
});
