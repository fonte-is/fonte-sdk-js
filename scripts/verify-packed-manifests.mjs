import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { packageOrder, readJson, root, run } from "./workspace-utils.mjs";

const packDir = join(root, ".artifacts", "packs");
const report = readJson(join(packDir, "pack-report.json"));
const verified = [];
const arguments_ = process.argv.slice(2);
assert.ok(
  arguments_.length === 0 ||
    (arguments_.length === 1 &&
      ["--application", "--core"].includes(arguments_[0])),
  "usage: verify-packed-manifests.mjs [--application|--core]",
);
const selected =
  arguments_[0] === "--core"
    ? ["core"]
    : arguments_[0] === "--application"
      ? packageOrder.filter((name) => name !== "cli")
      : packageOrder;
const coreDocs = [
  "results.md",
  "results-reference.md",
  "action-confirmations.md",
  "website-tracking.md",
  "application-outcomes.md",
];
const corePublicFiles = new Set([
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/CHANGELOG.md",
  ...coreDocs.map((name) => `package/docs/${name}`),
]);

function exportTargets(value, targets = []) {
  if (typeof value === "string") targets.push(value);
  else if (value && typeof value === "object") {
    for (const nested of Object.values(value)) exportTargets(nested, targets);
  }
  return targets;
}

for (const name of selected) {
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
  assert.equal(packedManifest.version, manifest.version);
  assert.deepEqual(packedManifest.exports, manifest.exports);
  assert.deepEqual(packedManifest.files, manifest.files);

  for (const target of exportTargets(packedManifest.exports)) {
    const normalized = posix.join("package", target.replace(/^\.\//, ""));
    assert.ok(
      entrySet.has(normalized),
      `${manifest.name} export target missing: ${target}`,
    );
  }
  for (const target of Object.values(packedManifest.bin ?? {})) {
    const normalized = posix.join("package", target.replace(/^\.\//, ""));
    assert.ok(
      entrySet.has(normalized),
      `${manifest.name} binary target missing: ${target}`,
    );
  }
  const allowedEntry =
    name === "cli"
      ? /^package\/(package\.json|LICENSE|README\.md|MCP_CONTRACT\.md|OPERATOR_CONTRACT\.md|dist\/|native\/)/
      : /^package\/(package\.json|README\.md|OPERATOR_CONTRACT\.md|dist\/)/;
  for (const entry of entries) {
    assert.ok(
      name === "core"
        ? entry.startsWith("package/dist/") || corePublicFiles.has(entry)
        : allowedEntry.test(entry),
      `${manifest.name} packed unexpected file ${entry}`,
    );
    assert.ok(
      !/\/src\//.test(entry) ||
        (name === "cli" &&
          entry.startsWith("package/native/client-auth-store/")),
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
    for (const doc of coreDocs) {
      assert.equal(
        run("tar", ["-xOzf", tarball, `package/docs/${doc}`], {
          capture: true,
        }),
        readFileSync(join(root, "docs", doc), "utf8"),
        `Core guide differs from source: ${doc}`,
      );
    }
    assert.equal(
      run("tar", ["-xOzf", tarball, "package/CHANGELOG.md"], { capture: true }),
      readFileSync(join(root, "packages", "core", "CHANGELOG.md"), "utf8"),
    );
  }
  if (name === "cli" || name === "core") {
    assert.equal(
      run("tar", ["-xOzf", tarball, "package/LICENSE"], { capture: true }),
      readFileSync(join(root, "LICENSE"), "utf8"),
    );
  }
  verified.push({
    name: manifest.name,
    entryCount: entries.length,
    exports: Object.keys(manifest.exports ?? {}),
    binaries: Object.keys(manifest.bin ?? {}),
  });
}

process.stdout.write(`${JSON.stringify({ ok: true, verified }, null, 2)}\n`);
