import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const core = path.join(root, "packages", "core");
const docs = path.join(core, "docs");

// Keep one source for the public guides and license. npm runs this before pack.
await rm(docs, { recursive: true, force: true });
await mkdir(docs, { recursive: true });
await copyFile(path.join(root, "LICENSE"), path.join(core, "LICENSE"));
for (const name of [
  "results.md",
  "results-reference.md",
  "action-confirmations.md",
  "website-tracking.md",
  "application-outcomes.md",
]) {
  await copyFile(path.join(root, "docs", name), path.join(docs, name));
}
