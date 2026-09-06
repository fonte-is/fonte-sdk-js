import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const publisher = await readFile(
  new URL("../scripts/publish-cli.mjs", import.meta.url),
  "utf8",
);
const head = "a".repeat(40);
const tree = "b".repeat(40);

test("publisher verifies the exact offline artifact without an install or historical receipt", async () => {
  const result = await runPublisher();
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, "dry_run_ready");
  assert.equal(receipt.artifactVerification.method, "offline_packed_artifact");
  assert.equal(receipt.artifactVerification.dependencyInstallation, false);
  assert.equal(receipt.artifactVerification.cleanInstallObserved, false);
  assert.equal(receipt.prerequisite, undefined);
  assert.equal(receipt.publishInvocationCount, 0);
  assert.deepEqual(result.npmCalls, ["pack"]);
});

test("publisher refuses stale source, dirty state, stale bytes, or the wrong binary before registry effects", async () => {
  for (const [options, error] of [
    [{ expectedRef: "c".repeat(40) }, "checked-out ref/tree does not match"],
    [{ dirty: true }, "release worktree must be clean"],
    [{ sourceDrift: true }, "git diff --quiet"],
    [{ staleBytes: true }, "packed CLI bytes do not match"],
    [
      { binaryVersion: "0.1.4" },
      "packed fonte binary reported an unexpected version",
    ],
  ]) {
    const result = await runPublisher({ ...options, publish: true });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(error), result.stderr);
    assert.equal(result.npmCalls.includes("view"), false);
    assert.equal(result.npmCalls.includes("publish"), false);
    assert.equal(result.npmCalls.includes("install"), false);
  }
});

test("an occupied version is never overwritten and an exact existing version is observed without publishing", async () => {
  const occupied = await runPublisher({ publish: true, mode: "occupied" });
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, /registry identity or digest differs/);
  assert.deepEqual(occupied.npmCalls, ["pack", "view"]);

  const exact = await runPublisher({ publish: true, mode: "already_exact" });
  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(JSON.parse(exact.stdout).outcome, "already_published_exact");
  assert.deepEqual(exact.npmCalls, ["pack", "view"]);
});

test("publication invokes once and ambiguous responses require exact registry readback, never a retry", async () => {
  for (const [mode, outcome] of [
    ["success", "published_exact"],
    ["ambiguous_exact", "published_exact_after_ambiguous_response"],
    ["ambiguous_absent", null],
  ]) {
    const result = await runPublisher({ publish: true, mode });
    assert.deepEqual(result.npmCalls, ["pack", "view", "publish", "view"]);
    if (outcome) {
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.outcome, outcome);
      assert.equal(receipt.publishInvocationCount, 1);
    } else {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /outcome is unknown.*do not retry/);
    }
  }
});

async function runPublisher(options = {}) {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "fonte-publisher-test-"),
  );
  try {
    await mkdir(path.join(fixture, "scripts"));
    await mkdir(path.join(fixture, "bin"));
    await mkdir(path.join(fixture, "packages", "cli"), { recursive: true });
    await mkdir(path.join(fixture, "packed", "package", "dist"), {
      recursive: true,
    });
    const manifest = {
      name: "@fonte-is/cli",
      version: "0.2.0",
      type: "module",
      bin: { fonte: "./dist/main.js" },
    };
    for (const target of [
      "packages/cli/package.json",
      "packed/package/package.json",
    ]) {
      await writeFile(path.join(fixture, target), JSON.stringify(manifest));
    }
    await writeFile(
      path.join(fixture, "package-lock.json"),
      JSON.stringify({ packages: { "packages/cli": { version: "0.2.0" } } }),
    );
    await writeFile(
      path.join(fixture, "packed/package/dist/main.js"),
      `process.stdout.write(${JSON.stringify(`@fonte-is/cli ${options.binaryVersion ?? "0.2.0"}\n`)});\n`,
    );
    const tarball = path.join(fixture, "fixture.tgz");
    const packed = spawnSync(
      "tar",
      ["-czf", tarball, "-C", path.join(fixture, "packed"), "package"],
      { encoding: "utf8" },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const bytes = await readFile(tarball);
    const digests = {
      sha1: createHash("sha1").update(bytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    };
    // Substitute only fixture artifact pins; execute the real publisher logic.
    const source = publisher.replace(
      /const reviewedTarballDigests = \{[\s\S]*?\n\};/,
      `const reviewedTarballDigests = ${JSON.stringify(options.staleBytes ? { ...digests, sha256: "0".repeat(64) } : digests)};`,
    );
    await writeFile(path.join(fixture, "scripts/publish-cli.mjs"), source);
    const pins = Object.fromEntries(
      [...publisher.matchAll(/const (reviewed\w+) = "([a-f0-9]+)";/g)].map(
        (match) => [match[1], match[2]],
      ),
    );
    const config = { ...options, head, tree, pins, fixture, digests };
    await writeFile(path.join(fixture, "config.json"), JSON.stringify(config));
    await writeFile(path.join(fixture, "calls.jsonl"), "");
    for (const command of ["git", "npm"]) {
      const target = path.join(fixture, "bin", command);
      await writeFile(target, fakeCommands);
      await chmod(target, 0o755);
    }
    const result = spawnSync(
      process.execPath,
      [
        path.join(fixture, "scripts/publish-cli.mjs"),
        "--expected-ref",
        options.expectedRef ?? head,
        "--expected-tree",
        tree,
        ...(options.publish ? ["--publish"] : []),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${path.join(fixture, "bin")}${path.delimiter}${process.env.PATH}`,
          FONTE_PUBLISHER_TEST_CONFIG: path.join(fixture, "config.json"),
        },
      },
    );
    const calls = (await readFile(path.join(fixture, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return {
      ...result,
      npmCalls: calls
        .filter(({ command }) => command === "npm")
        .map(({ args }) => args[0]),
    };
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

const fakeCommands = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(process.env.FONTE_PUBLISHER_TEST_CONFIG, "utf8"));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(config.fixture, "calls.jsonl"), JSON.stringify({ command, args }) + "\\n");
if (command === "git") {
  if (args[0] === "status") process.stdout.write(config.dirty ? " M dirty\\n" : "");
  else if (args[0] === "diff") process.exit(config.sourceDrift ? 1 : 0);
  else if (args[0] === "rev-parse") {
    const values = {
      HEAD: config.head,
      "HEAD^{tree}": config.tree,
      [config.pins.reviewedPackageRef + "^{tree}"]: config.pins.reviewedSourceTree,
      [config.pins.reviewedPackageRef + ":packages/cli"]: config.pins.reviewedCliTree,
      [config.pins.reviewedPackageRef + ":package-lock.json"]: config.pins.reviewedPackageLockBlob,
      [config.pins.reviewedPackageRef + ":packages/cli/package.json"]: config.pins.reviewedManifestBlob,
    };
    if (!values[args[1]]) process.exit(2);
    process.stdout.write(values[args[1]] + "\\n");
  } else process.exit(2);
} else if (args[0] === "pack") {
  const destination = args[args.indexOf("--pack-destination") + 1];
  fs.copyFileSync(path.join(config.fixture, "fixture.tgz"), path.join(destination, "fixture.tgz"));
  process.stdout.write(JSON.stringify([{ name: "@fonte-is/cli", version: "0.2.0", filename: "fixture.tgz" }]));
} else if (args[0] === "view") {
  if (config.mode === "occupied" || config.mode === "already_exact" || fs.existsSync(path.join(config.fixture, "published"))) {
    process.stdout.write(JSON.stringify({ name: "@fonte-is/cli", version: "0.2.0", dist: { integrity: config.mode === "occupied" ? "different" : config.digests.integrity, shasum: config.digests.sha1 } }));
  } else { process.stderr.write("E404"); process.exit(1); }
} else if (args[0] === "publish") {
  if (config.mode !== "ambiguous_absent") fs.writeFileSync(path.join(config.fixture, "published"), "yes");
  process.exit(config.mode === "success" ? 0 : 1);
} else { process.stderr.write("unexpected command: " + args[0]); process.exit(2); }
`;
