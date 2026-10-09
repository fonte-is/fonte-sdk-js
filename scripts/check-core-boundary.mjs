import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, root } from "./workspace-utils.mjs";

const coreDir = join(root, "packages", "core");
const manifest = readJson(join(coreDir, "package.json"));
assert.deepEqual(manifest.dependencies ?? {}, {});
assert.deepEqual(manifest.peerDependencies ?? {}, {});

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(join(coreDir, "src"));
walk(join(coreDir, "dist"));

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const specifiers = [
    ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
  ].map((match) => match[2]);
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith(".") || specifier.startsWith("node:"),
      `${file} imports an undeclared dependency ${specifier}`,
    );
  }
}

process.stdout.write(
  `${JSON.stringify({ ok: true, package: manifest.name, dependencies: [], scannedFiles: files.length }, null, 2)}\n`,
);
