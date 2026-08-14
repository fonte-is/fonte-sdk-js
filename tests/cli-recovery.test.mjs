import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const json = async (target) => JSON.parse(await readFile(target, "utf8"));
const exists = async (target) =>
  readFile(target).then(
    () => true,
    (error) => (error.code === "ENOENT" ? false : Promise.reject(error)),
  );

async function createFixture({ packageLock = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fonte-cli-recovery-"));
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
        dependencies: {},
      },
      null,
      2,
    )}\n`,
  );
  if (packageLock) {
    await writeFile(
      path.join(root, "package-lock.json"),
      '{\n  "lockfileVersion": 3\n}\n',
    );
  }
  await writeFile(path.join(root, ".gitignore"), "node_modules\n");
  return root;
}

async function installFakeSdk(root) {
  const directory = path.join(root, "node_modules/@fonte-is/nextjs");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({
      name: "@fonte-is/nextjs",
      version: "0.1.0",
      type: "module",
      exports: {
        "./installation-verification": "./installation-verification.js",
      },
    })}\n`,
  );
  await writeFile(
    path.join(directory, "installation-verification.js"),
    [
      'export const FONTE_CONFIG_VERSION = "fonte.config.v2";',
      'export const INSTALLATION_VERIFICATION_SCHEMA_VERSION = "fonte.installation_verification.v2";',
      'export const INSTALLATION_VERIFICATION_SDK_VERSION = "0.1.0";',
      'export const INSTALLATION_VERIFICATION_ADAPTER_ID = "next_app_router";',
      'export const INSTALLATION_VERIFICATION_ADAPTER_VERSION = "v1";',
      "export const normalizeInstallationVerificationConfig = value => value;",
      "",
    ].join("\n"),
  );
}

function createRunner(calls) {
  return {
    async run(command, args, cwd) {
      calls.push([command, [...args]]);
      if (
        args[0] === "install" &&
        args.some((arg) => arg.includes("nextjs@"))
      ) {
        const manifest = await json(path.join(cwd, "package.json"));
        manifest.dependencies["@fonte-is/nextjs"] = "0.1.0";
        await writeFile(
          path.join(cwd, "package.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
        if (!args.includes("--package-lock=false")) {
          await writeFile(path.join(cwd, "package-lock.json"), "installed\n");
        }
        await installFakeSdk(cwd);
        return 0;
      }
      if (args[0] === "uninstall") {
        const manifest = await json(path.join(cwd, "package.json"));
        delete manifest.dependencies["@fonte-is/nextjs"];
        await writeFile(
          path.join(cwd, "package.json"),
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
        return 0;
      }
      return 0;
    },
  };
}

const dependencies = (root, runner) => ({
  cwd: root,
  randomUUID: () => "10000000-0000-4000-8000-000000000009",
  runner,
});

test("a failed rollback is surfaced distinctly", async () => {
  const root = await createFixture();
  const result = await runProgram(
    ["init", "--yes"],
    dependencies(root, { run: async () => 1 }),
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "Fonte failed: rollback_failed.\n");
});

test("a failed install reconciles and restores exact bytes", async () => {
  const root = await createFixture();
  const before = await readFile(path.join(root, "package.json"), "utf8");
  let call = 0;
  const runner = {
    async run(_command, _args, cwd) {
      call += 1;
      if (call === 1) {
        await writeFile(path.join(cwd, "package.json"), '{"changed":true}\n');
        await writeFile(path.join(cwd, "package-lock.json"), "changed\n");
        return 1;
      }
      await writeFile(path.join(cwd, "package-lock.json"), "reconciled\n");
      return 0;
    },
  };
  const result = await runProgram(
    ["init", "--yes"],
    dependencies(root, runner),
  );
  assert.equal(result.stderr, "Fonte failed: execution_failed.\n");
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), before);
});

test("doctor never executes a project-owned script", async () => {
  const root = await createFixture();
  const calls = [];
  const request = dependencies(root, createRunner(calls));
  assert.equal((await runProgram(["init", "--yes"], request)).exitCode, 0);
  const afterInit = calls.length;
  assert.equal((await runProgram(["doctor"], request)).exitCode, 0);
  assert.equal(calls.length, afterInit);
});

test("a project without a lockfile never gains one", async () => {
  const root = await createFixture({ packageLock: false });
  const calls = [];
  const request = dependencies(root, createRunner(calls));
  assert.equal((await runProgram(["init", "--yes"], request)).exitCode, 0);
  assert.equal(await exists(path.join(root, "package-lock.json")), false);
  assert.equal(calls[0][1].includes("--package-lock=false"), true);
  assert.equal((await runProgram(["remove", "--yes"], request)).exitCode, 0);
  assert.equal(await exists(path.join(root, "package-lock.json")), false);
});

test("rollback preserves a concurrently created unmanaged source", async () => {
  const root = await createFixture();
  const calls = [];
  const runner = createRunner(calls);
  const originalRun = runner.run.bind(runner);
  runner.run = async (command, args, cwd) => {
    const result = await originalRun(command, args, cwd);
    if (args.some((arg) => arg.includes("nextjs@"))) {
      await mkdir(path.join(cwd, "fonte"), { recursive: true });
      await writeFile(path.join(cwd, "fonte/installation.ts"), "unowned\n");
    }
    return result;
  };
  const result = await runProgram(
    ["init", "--yes"],
    dependencies(root, runner),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(
    await readFile(path.join(root, "fonte/installation.ts"), "utf8"),
    "unowned\n",
  );
});
