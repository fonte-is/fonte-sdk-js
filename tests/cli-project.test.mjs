import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { detectProject } from "../packages/cli/dist/project.js";
import {
  assertManagedPathSafe,
  resolveManagedPath,
} from "../packages/cli/dist/paths.js";

const temporaryRoots = [];
test.after(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fonte-cli-project-"));
  temporaryRoots.push(root);
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
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

test("detects only one npm Next.js App Router root", async () => {
  const root = await fixture();
  const project = await detectProject(root);
  assert.equal(project.root, await realpath(root));
  assert.equal(project.app_directory, "app");
  assert.equal(project.package_manager, "npm");
});

test("foreign package managers and ambiguous app roots block", async () => {
  const foreign = await fixture();
  await writeFile(path.join(foreign, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  await assert.rejects(() => detectProject(foreign), {
    reason: "unsupported_package_manager",
  });

  const ambiguous = await fixture();
  await mkdir(path.join(ambiguous, "src/app"), { recursive: true });
  await writeFile(
    path.join(ambiguous, "src/app/layout.tsx"),
    "export default null;\n",
  );
  await assert.rejects(() => detectProject(ambiguous), {
    reason: "ambiguous_app_router_root",
  });
});

test("managed paths reject traversal, metadata, dependencies, and symlinks", async () => {
  const root = await fixture();
  for (const candidate of ["../outside", ".git/config", "node_modules/x", ""])
    assert.throws(() => resolveManagedPath(root, candidate), {
      reason: "managed_path_unsafe",
    });

  await mkdir(path.join(root, "linked-target"));
  await import("node:fs/promises").then(({ symlink }) =>
    symlink(path.join(root, "linked-target"), path.join(root, "fonte")),
  );
  await assert.rejects(
    () => assertManagedPathSafe(root, "fonte/installation.ts"),
    { reason: "managed_path_unsafe" },
  );
});

test("a directory or symlink cannot impersonate an App Router layout", async () => {
  const directory = await fixture();
  await rm(path.join(directory, "app/layout.tsx"));
  await mkdir(path.join(directory, "app/layout.ts"));
  await assert.rejects(() => detectProject(directory), {
    reason: "unsupported_framework",
  });

  const linked = await fixture();
  await rm(path.join(linked, "app/layout.tsx"));
  await writeFile(
    path.join(linked, "real-layout.tsx"),
    "export default null;\n",
  );
  await import("node:fs/promises").then(({ symlink }) =>
    symlink(
      path.join(linked, "real-layout.tsx"),
      path.join(linked, "app/layout.tsx"),
    ),
  );
  await assert.rejects(() => detectProject(linked), {
    reason: "unsupported_framework",
  });
});
