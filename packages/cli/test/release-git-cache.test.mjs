import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { syntheticReleaseRemote } from "./fixtures/release-git-remote.mjs";

const launcher = new URL("../dist/main.js", import.meta.url).pathname;
const launch = (directory, fixture, source = fixture.source, extra = {}) =>
  spawnSync(process.execPath, [launcher, "release", "--source", source], {
    cwd: directory,
    encoding: "utf8",
    env: fixture.environment(source),
    ...extra,
  });

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), "fonte-release-git-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("fresh cold and warm processes fetch source once and observe new canonical main", (t) => {
  const directory = workspace(t);
  const fixture = syntheticReleaseRemote(directory);
  for (const phase of ["cold", "warm", "new-main"]) {
    if (phase === "new-main") fixture.advanceMain();
    const trace = join(directory, `${phase}.trace`);
    const result = launch(directory, fixture, fixture.source, {
      env: fixture.environment(fixture.source, undefined, trace),
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /release_status=VERIFIED/u);
    const fetches = readFileSync(trace, "utf8")
      .split("\n")
      .filter((line) => /built-in: git fetch /u.test(line));
    assert.equal(fetches.length, 2, fetches.join("\n"));
    assert.equal(
      fetches.filter((line) => line.endsWith(fixture.source)).length,
      1,
    );
    if (phase === "warm") {
      assert.ok(fetches.some((line) => line.includes("--negotiation-tip=")));
      const received = readFileSync(trace, "utf8")
        .split("\n")
        .filter(
          (line) =>
            /built-in: git (?:index-pack|unpack-objects) /u.test(line) &&
            !/--pack_header=\d+,0(?:\s|$)/u.test(line),
        );
      assert.equal(received.length, 1, received.join("\n"));
    }
  }
});

test("four concurrent cold CLI processes keep source fetch receipts and checkouts isolated", async (t) => {
  const directory = workspace(t);
  const fixture = syntheticReleaseRemote(directory);
  const execute = promisify(execFile);
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, index) => {
      const source = index % 2 ? fixture.nextSource : fixture.source;
      return execute(
        process.execPath,
        [launcher, "release", "--source", source],
        {
          cwd: directory,
          encoding: "utf8",
          env: fixture.environment(source),
        },
      );
    }),
  );
  for (const result of results)
    assert.match(result.stdout, /release_status=VERIFIED/u);
  const warm = launch(directory, fixture);
  assert.equal(warm.status, 0, warm.stderr || warm.stdout);
});

test("a corrupt cached object falls back to verified cold remote objects", (t) => {
  const directory = workspace(t);
  const fixture = syntheticReleaseRemote(directory);
  assert.equal(launch(directory, fixture).status, 0);
  const objects = join(
    directory,
    "cache",
    "fonte",
    "release-git-v1",
    "objects",
  );
  const prefix = readdirSync(objects).find((name) =>
    /^[0-9a-f]{2}$/u.test(name),
  );
  assert.ok(prefix);
  const object = readdirSync(join(objects, prefix))[0];
  assert.ok(object);
  chmodSync(join(objects, prefix, object), 0o600);
  writeFileSync(join(objects, prefix, object), "tampered cached Git object");
  const result = launch(directory, fixture);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /release_status=VERIFIED/u);
});

test("cached application objects cannot authorize source absent from the current upstream", (t) => {
  const directory = workspace(t);
  const original = syntheticReleaseRemote(directory);
  assert.equal(launch(directory, original).status, 0);
  const replacement = syntheticReleaseRemote(directory, "replacement");
  const result = launch(directory, replacement, original.source);
  assert.equal(result.status, 3, result.stderr || result.stdout);
  assert.match(result.stdout, /source_not_remote/u);
  assert.doesNotMatch(result.stdout, /release_status=VERIFIED/u);
});

test("unwritable optional cache does not block the canonical executor", (t) => {
  const directory = workspace(t);
  const fixture = syntheticReleaseRemote(directory);
  const cache = join(directory, "not-a-directory");
  writeFileSync(cache, "unavailable cache");
  const result = launch(directory, fixture, fixture.source, {
    env: fixture.environment(fixture.source, cache),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
