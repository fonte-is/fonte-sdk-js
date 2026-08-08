import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, root } from "./workspace-utils.mjs";

const forbidden = ["react", "react-dom", "next", "nextjs", "stripe", "@stripe"];
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
  assert.ok(
    !source.includes("next_app_router"),
    `${file} contains Next.js adapter behavior`,
  );
  assert.ok(
    !source.toLowerCase().includes("stripe"),
    `${file} contains Stripe provider behavior`,
  );
  for (const dependency of forbidden) {
    const pattern = new RegExp(
      `(?:from\\s+|import\\s*\\()(["'])[^"']*${dependency}[^"']*\\1`,
      "i",
    );
    assert.ok(
      !pattern.test(source),
      `${file} imports forbidden Core dependency ${dependency}`,
    );
  }
}

process.stdout.write(
  `${JSON.stringify({ ok: true, package: manifest.name, dependencies: [], scannedFiles: files.length }, null, 2)}\n`,
);
