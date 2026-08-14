import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  IGNORE_BLOCK_TEXT,
  MANAGED_SOURCE_TEXT,
} from "../packages/cli/dist/constants.js";
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

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fonte-cli-journey-"));
  roots.push(root);
  await mkdir(path.join(root, "app"), { recursive: true });
  await writeFile(path.join(root, "app/layout.tsx"), "export default null;\n");
  const manifest = {
    name: "fonte-cli-fixture",
    private: true,
    packageManager: "npm@10.9.2",
    scripts: { typecheck: "node --version" },
    dependencies: {
      next: "16.2.11",
      react: "19.2.0",
      "react-dom": "19.2.0",
    },
  };
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (options.packageLock !== false) {
    await writeFile(
      path.join(root, "package-lock.json"),
      '{\n  "lockfileVersion": 3\n}\n',
    );
  }
  await writeFile(
    path.join(root, ".gitignore"),
    options.ignore ?? "node_modules\n",
  );
  return { root, manifest };
}

async function installFakeSdk(root) {
  const directory = path.join(root, "node_modules/@fonte-is/nextjs");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "@fonte-is/nextjs",
        version: "0.1.0",
        type: "module",
        exports: {
          "./installation-verification": "./installation-verification.js",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(directory, "installation-verification.js"),
    [
      'export const FONTE_CONFIG_VERSION = "fonte.config.v2";',
      'export const INSTALLATION_VERIFICATION_SCHEMA_VERSION = "fonte.installation_verification.v2";',
      'export const INSTALLATION_VERIFICATION_SDK_VERSION = "0.1.0";',
      'export const INSTALLATION_VERIFICATION_ADAPTER_ID = "next_app_router";',
      'export const INSTALLATION_VERIFICATION_ADAPTER_VERSION = "v1";',
      "export function normalizeInstallationVerificationConfig(value) {",
      "  return value && value.installationAttemptId ? value : null;",
      "}",
      "",
    ].join("\n"),
  );
}

function createRunner(calls) {
  return {
    async run(command, args, cwd) {
      calls.push([command, [...args]]);
      assert.equal(command, "npm");
      if (
        args[0] === "install" &&
        args.some((arg) => arg.startsWith("@fonte-is/nextjs@"))
      ) {
        const manifestPath = path.join(cwd, "package.json");
        const manifest = await json(manifestPath);
        manifest.dependencies["@fonte-is/nextjs"] = "0.1.0";
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        if (!args.includes("--package-lock=false")) {
          await writeFile(
            path.join(cwd, "package-lock.json"),
            '{\n  "lockfileVersion": 3,\n  "fonteFixture": true\n}\n',
          );
        }
        await installFakeSdk(cwd);
        return 0;
      }
      if (args[0] === "uninstall") {
        const manifestPath = path.join(cwd, "package.json");
        const manifest = await json(manifestPath);
        delete manifest.dependencies["@fonte-is/nextjs"];
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await rm(path.join(cwd, "node_modules/@fonte-is/nextjs"), {
          recursive: true,
          force: true,
        });
        return 0;
      }
      if (args[0] === "run" && args[1] === "typecheck") return 0;
      if (args[0] === "install") return 0;
      return 1;
    },
  };
}

test("plan, init, idempotent init, doctor, drift refusal, and remove", async () => {
  const { root, manifest: originalManifest } = await createFixture();
  const calls = [];
  const dependencies = {
    cwd: root,
    randomUUID: () => "10000000-0000-4000-8000-000000000001",
    runner: createRunner(calls),
  };

  const plan = await runProgram(["init", "--json"], dependencies);
  assert.equal(plan.exitCode, 0);
  assert.equal(JSON.parse(plan.stdout).outcome, "planned");
  assert.equal(calls.length, 0);
  assert.deepEqual(
    await json(path.join(root, "package.json")),
    originalManifest,
  );
  assert.equal(
    await exists(path.join(root, ".fonte/installation.json")),
    false,
  );

  const init = await runProgram(["init", "--yes", "--json"], dependencies);
  const initReceipt = JSON.parse(init.stdout);
  assert.equal(init.exitCode, 0);
  assert.equal(initReceipt.outcome, "applied");
  assert.equal(initReceipt.state, "prepared");
  assert.equal(initReceipt.provider_effect, "none");
  assert.equal(initReceipt.application_email, "unavailable");
  assert.deepEqual(initReceipt.next_action, {
    kind: "activation_unavailable",
    reason: "fonte_activation_not_implemented",
  });
  assert.equal(
    await readFile(path.join(root, "fonte/installation.ts"), "utf8"),
    MANAGED_SOURCE_TEXT,
  );
  assert.equal(
    await readFile(path.join(root, ".gitignore"), "utf8"),
    `node_modules\n${IGNORE_BLOCK_TEXT}`,
  );
  const localManifest = await json(path.join(root, ".fonte/installation.json"));
  assert.equal(localManifest.installation_id, dependencies.randomUUID());
  assert.equal("secret" in localManifest, false);
  assert.equal(
    (await stat(path.join(root, ".fonte/installation.json"))).mode & 0o777,
    0o600,
  );

  const callsAfterInit = calls.length;
  const secondInit = await runProgram(
    ["init", "--yes", "--json"],
    dependencies,
  );
  assert.equal(secondInit.exitCode, 0);
  assert.equal(JSON.parse(secondInit.stdout).outcome, "verified");
  assert.equal(calls.length, callsAfterInit);

  const doctor = await runProgram(["doctor", "--json"], dependencies);
  assert.equal(doctor.exitCode, 0);
  assert.equal(JSON.parse(doctor.stdout).reason, "installation_verified");
  assert.equal(calls.length, callsAfterInit);

  const originalSource = await readFile(
    path.join(root, "fonte/installation.ts"),
    "utf8",
  );
  await writeFile(
    path.join(root, "fonte/installation.ts"),
    `${originalSource}// user edit\n`,
  );
  const blocked = await runProgram(["remove", "--yes", "--json"], dependencies);
  assert.equal(blocked.exitCode, 3);
  assert.equal(JSON.parse(blocked.stdout).reason, "managed_code_drifted");
  assert.equal(
    (await json(path.join(root, "package.json"))).dependencies[
      "@fonte-is/nextjs"
    ],
    "0.1.0",
  );

  await writeFile(path.join(root, "fonte/installation.ts"), originalSource);
  const removePlan = await runProgram(["remove", "--json"], dependencies);
  assert.equal(removePlan.exitCode, 0);
  assert.equal(JSON.parse(removePlan.stdout).outcome, "planned");
  assert.equal(await exists(path.join(root, ".fonte/installation.json")), true);

  const removed = await runProgram(["remove", "--yes", "--json"], dependencies);
  assert.equal(removed.exitCode, 0);
  assert.equal(JSON.parse(removed.stdout).outcome, "removed");
  assert.deepEqual(
    await json(path.join(root, "package.json")),
    originalManifest,
  );
  assert.equal(await exists(path.join(root, "fonte/installation.ts")), false);
  assert.equal(
    await exists(path.join(root, ".fonte/installation.json")),
    false,
  );
  assert.equal(
    await readFile(path.join(root, ".gitignore"), "utf8"),
    "node_modules\n",
  );
});

test("a pre-existing exact ignore rule is preserved and never claimed", async () => {
  const initialIgnore = "node_modules\n/.fonte/\n";
  const { root } = await createFixture({ ignore: initialIgnore });
  const calls = [];
  const dependencies = {
    cwd: root,
    randomUUID: () => "10000000-0000-4000-8000-000000000002",
    runner: createRunner(calls),
  };
  assert.equal((await runProgram(["init", "--yes"], dependencies)).exitCode, 0);
  const manifest = await json(path.join(root, ".fonte/installation.json"));
  assert.equal(
    manifest.managed_operations.some(({ id }) => id === "local_state_ignore"),
    false,
  );
  assert.equal(
    (await runProgram(["remove", "--yes"], dependencies)).exitCode,
    0,
  );
  assert.equal(
    await readFile(path.join(root, ".gitignore"), "utf8"),
    initialIgnore,
  );
});
