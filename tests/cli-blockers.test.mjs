import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { runProgram } from "../packages/cli/dist/program.js";

const roots = [];
test.after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fonte-cli-blocker-"));
  roots.push(root);
  await mkdir(path.join(root, "app"), { recursive: true });
  await writeFile(path.join(root, "app/layout.tsx"), "export default null;\n");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        private: true,
        packageManager: "npm@10.9.2",
        scripts: { typecheck: "node --version" },
        dependencies: {},
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, ".gitignore"), "node_modules\n");
  return root;
}

const dependencies = (root) => ({
  cwd: root,
  randomUUID: () => "10000000-0000-4000-8000-000000000004",
  runner: { run: async () => 0 },
});

test("a conflicting SDK dependency blocks without writes", async () => {
  const root = await fixture({
    dependencies: { "@fonte-is/nextjs": "^0.1.0" },
  });
  const result = await runProgram(
    ["init", "--yes", "--json"],
    dependencies(root),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(result.stdout).reason, "dependency_version_conflict");
});

test("an unmanaged target file blocks even when it looks harmless", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "fonte"));
  await writeFile(path.join(root, "fonte/installation.ts"), "export {};\n");
  const result = await runProgram(["init", "--json"], dependencies(root));
  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(result.stdout).reason, "existing_unmanaged_path");
});

test("machine receipts never disclose the absolute project root", async () => {
  const root = await fixture();
  const result = await runProgram(["init", "--json"], dependencies(root));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.includes(root), false);
});
