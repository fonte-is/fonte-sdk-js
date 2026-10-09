import { rm } from "node:fs/promises";

// Removed modules must not survive into a later package from an earlier build.
await rm(new URL("../packages/core/dist/", import.meta.url), {
  recursive: true,
  force: true,
});
