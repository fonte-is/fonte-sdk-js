import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

await Promise.all([
  ...["core", "react", "nextjs"].map((name) =>
    rm(path.join(root, "packages", name, "dist"), {
      recursive: true,
      force: true,
    }),
  ),
  rm(path.join(root, ".artifacts"), { recursive: true, force: true }),
  rm(path.join(root, ".cache"), { recursive: true, force: true }),
]);
