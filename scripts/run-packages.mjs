import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  ensureWorkspaceLinks,
  packageOrder,
  root,
  run,
} from "./workspace-utils.mjs";

const command = process.argv[2];
const commands = new Set(["build", "typecheck", "typecheck:strict"]);
if (!commands.has(command)) {
  throw new Error(
    "usage: node scripts/run-packages.mjs build|typecheck|typecheck:strict",
  );
}

ensureWorkspaceLinks();
for (const name of packageOrder) {
  if (command === "build") {
    rmSync(join(root, "packages", name, "dist"), {
      recursive: true,
      force: true,
    });
  }
  process.stdout.write(`[fonte-sdk] ${command} @fonte-is/${name}\n`);
  run("npm", ["run", command, "--workspace", `@fonte-is/${name}`]);
}
