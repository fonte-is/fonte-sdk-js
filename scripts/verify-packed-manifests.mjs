import assert from "node:assert/strict";
import { join, posix } from "node:path";
import { packageOrder, readJson, root, run } from "./workspace-utils.mjs";

const packDir = join(root, ".artifacts", "packs");
const report = readJson(join(packDir, "pack-report.json"));
const verified = [];

function exportTargets(value, targets = []) {
  if (typeof value === "string") targets.push(value);
  else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) exportTargets(nested, targets);
  }
  return targets;
}

for (const name of packageOrder) {
  const manifest = readJson(join(root, "packages", name, "package.json"));
  const packed = report.packages.find((item) => item.name === manifest.name);
  assert.ok(packed, `missing pack report for ${manifest.name}`);
  const tarball = join(packDir, packed.filename);
  const entries = run("tar", ["-tzf", tarball], { capture: true })
    .trim()
    .split("\n")
    .filter(Boolean);
  const entrySet = new Set(entries);
  const packedManifest = JSON.parse(
    run("tar", ["-xOzf", tarball, "package/package.json"], { capture: true }),
  );
  assert.equal(packedManifest.name, manifest.name);
  assert.equal(packedManifest.version, "0.1.0");
  assert.deepEqual(packedManifest.exports, manifest.exports);
  assert.deepEqual(packedManifest.files, manifest.files);

  for (const target of exportTargets(packedManifest.exports)) {
    const normalized = posix.join("package", target.replace(/^\.\//, ""));
    assert.ok(
      entrySet.has(normalized),
      `${manifest.name} export target missing: ${target}`,
    );
  }
  for (const entry of entries) {
    assert.match(
      entry,
      /^package\/(package\.json|README\.md|dist\/)/,
      `${manifest.name} packed unexpected file ${entry}`,
    );
    assert.ok(
      !/\/src\//.test(entry),
      `${manifest.name} leaked source: ${entry}`,
    );
    assert.ok(
      !/\.(ts|tsx)$/.test(entry) || entry.endsWith(".d.ts"),
      `${manifest.name} leaked TypeScript source: ${entry}`,
    );
  }
  if (name === "core") {
    assert.deepEqual(packedManifest.dependencies ?? {}, {});
    assert.deepEqual(packedManifest.peerDependencies ?? {}, {});
  }
  verified.push({
    name: manifest.name,
    entryCount: entries.length,
    exports: Object.keys(manifest.exports),
  });
}

process.stdout.write(`${JSON.stringify({ ok: true, verified }, null, 2)}\n`);
