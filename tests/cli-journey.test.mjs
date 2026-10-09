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

async function installFakeSdk(root, sdkVersion = "0.2.0") {
  const directory = path.join(root, "node_modules/@fonte-is/nextjs");
  await mkdir(path.join(directory, "dist"), { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "@fonte-is/nextjs",
        version: sdkVersion,
        type: "module",
        exports: {
          "./installation-verification": {
            types: "./dist/installation-verification.d.ts",
            import: "./dist/installation-verification.js",
            default: "./dist/installation-verification.js",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(directory, "dist/installation-verification.js"),
    [
      'export const FONTE_CONFIG_VERSION = "fonte.config.v2";',
      'export const INSTALLATION_VERIFICATION_SCHEMA_VERSION = "fonte.installation_verification.v2";',
      `export const INSTALLATION_VERIFICATION_SDK_VERSION = "${sdkVersion}";`,
      'export const INSTALLATION_VERIFICATION_ADAPTER_ID = "next_app_router";',
      'export const INSTALLATION_VERIFICATION_ADAPTER_VERSION = "v1";',
      "export function normalizeInstallationVerificationConfig(value) {",
      "  return value && value.installationAttemptId ? value : null;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(directory, "dist/installation-verification.d.ts"),
    "export {};\n",
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
        assert.ok(args.includes("@fonte-is/nextjs@0.2.0"));
        const manifestPath = path.join(cwd, "package.json");
        const manifest = await json(manifestPath);
        manifest.dependencies["@fonte-is/nextjs"] = "0.2.0";
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

async function runHostedProviderProof(dependencies) {
  const responses = [
    {
      schema: "fonte.cli.hosted_config.v1",
      authorizationServer: "https://accounts.example.test/auth/v1",
      clientId: "fonte-cli-client-v0",
      coreApiBaseUrl: "https://api.fonte.is",
      redirectUri: "http://127.0.0.1:49671/callback",
      scopes: ["email"],
    },
    {
      draft: {
        broadcastDraftId: "10000000-0000-4000-8000-000000000020",
        version: 1,
      },
    },
    { sandboxEmailId: "10000000-0000-4000-8000-000000000021" },
    {
      status: "terminal",
      provider: {
        acceptedCount: 0,
        refusedCount: 1,
        unknownCount: 0,
        messageId: null,
        errorCode: "provider_refused",
      },
      billing: { quantity: 0 },
    },
  ];
  return runProgram(["test", "--workspace", "fonte", "--json"], {
    ...dependencies,
    hosted: {
      fetch: async () =>
        new Response(JSON.stringify(responses.shift()), {
          headers: { "content-type": "application/json" },
        }),
      authorize: async () => "header.payload.signature",
      sleep: async () => undefined,
    },
  });
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
    kind: "run_command",
    command: "npx @fonte-is/cli test --workspace <slug>",
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
  assert.equal(localManifest.sdk_version, "0.2.0");
  assert.equal(localManifest.managed_operations[0].version, "0.2.0");
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

  const hostedTest = await runHostedProviderProof(dependencies);
  assert.equal(hostedTest.exitCode, 3);
  assert.equal(JSON.parse(hostedTest.stdout).provider_submission, "refused");
  assert.equal(JSON.parse(hostedTest.stdout).accepted_email_usage_quantity, 0);
  assert.equal(JSON.parse(hostedTest.stdout).sandbox_draft_retained, true);

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
    "0.2.0",
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

test("a recorded SDK 0.1.0 installation remains removable without claiming an upgrade", async () => {
  const { root } = await createFixture();
  const packagePath = path.join(root, "package.json");
  const packageManifest = await json(packagePath);
  packageManifest.dependencies["@fonte-is/nextjs"] = "0.1.0";
  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  await installFakeSdk(root, "0.1.0");
  await mkdir(path.join(root, "fonte"));
  await mkdir(path.join(root, ".fonte"));
  await writeFile(
    path.join(root, "fonte/installation.ts"),
    MANAGED_SOURCE_TEXT,
  );
  await writeFile(
    path.join(root, ".gitignore"),
    `node_modules\n${IGNORE_BLOCK_TEXT}`,
  );
  const localManifest = {
    schema_version: "fonte.local_installation.v1",
    installation_id: "10000000-0000-4000-8000-000000000008",
    cli_version: "0.3.5",
    adapter_id: "next_app_router",
    adapter_version: "v1",
    sdk_package: "@fonte-is/nextjs",
    sdk_version: "0.1.0",
    plan_sha256:
      "1e6abf4b2493eb39615354e818bf80c03fe371a9b75f716b928bc2bf7e05c6c1",
    managed_operations: [
      {
        id: "sdk_dependency",
        kind: "dependency",
        path: "package.json",
        package: "@fonte-is/nextjs",
        version: "0.1.0",
        previous: "absent",
      },
      {
        id: "installation_module",
        kind: "created_file",
        path: "fonte/installation.ts",
        sha256:
          "e04dc9dbd826fe97e4c7a0a186693c85e87787cd74a2c40d4de19f6954fa0d5c",
      },
      {
        id: "local_state_ignore",
        kind: "managed_block",
        path: ".gitignore",
        sha256:
          "c1d433b118869fa669ee813100aecbca385b3fdb0257992f40f6c21607ce4f5a",
      },
    ],
  };
  const manifestPath = path.join(root, ".fonte/installation.json");
  const recordedBytes = `${JSON.stringify(localManifest, null, 2)}\n`;
  await writeFile(manifestPath, recordedBytes);
  const calls = [];
  const request = {
    cwd: root,
    randomUUID: () => localManifest.installation_id,
    runner: createRunner(calls),
  };

  const doctor = await runProgram(["doctor", "--json"], request);
  assert.equal(doctor.exitCode, 0);
  assert.equal(
    JSON.parse(doctor.stdout).reason,
    "recorded_sdk_installation_verified",
  );
  assert.equal(JSON.parse(doctor.stdout).next_action, null);
  const humanDoctor = await runProgram(["doctor"], request);
  assert.match(
    humanDoctor.stdout,
    /recorded Fonte SDK 0\.1\.0 installation is intact/,
  );
  assert.match(
    humanDoctor.stdout,
    /Current setup targets SDK 0\.2\.0\. No upgrade was performed/,
  );
  const init = await runProgram(["init", "--yes", "--json"], request);
  assert.equal(init.exitCode, 3);
  assert.equal(JSON.parse(init.stdout).reason, "dependency_version_conflict");
  assert.equal(calls.length, 0);
  assert.equal(await readFile(manifestPath, "utf8"), recordedBytes);
  assert.equal(
    (await json(packagePath)).dependencies["@fonte-is/nextjs"],
    "0.1.0",
  );

  const mismatchedPackage = await json(packagePath);
  mismatchedPackage.dependencies["@fonte-is/nextjs"] = "0.2.0";
  await writeFile(
    packagePath,
    `${JSON.stringify(mismatchedPackage, null, 2)}\n`,
  );
  const drift = await runProgram(["remove", "--yes", "--json"], request);
  assert.equal(drift.exitCode, 3);
  assert.equal(JSON.parse(drift.stdout).reason, "managed_code_drifted");
  assert.equal(calls.length, 0);
  await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  const originalPackageBytes = await readFile(packagePath, "utf8");
  const lockPath = path.join(root, "package-lock.json");
  const originalLockBytes = await readFile(lockPath, "utf8");
  let failedRemovalCalls = 0;
  const failedRemoval = await runProgram(["remove", "--yes", "--json"], {
    ...request,
    runner: {
      async run(_command, args) {
        failedRemovalCalls += 1;
        if (args[0] === "uninstall") {
          const changed = await json(packagePath);
          delete changed.dependencies["@fonte-is/nextjs"];
          await writeFile(packagePath, `${JSON.stringify(changed)}\n`);
          await writeFile(lockPath, "interrupted removal\n");
          return 1;
        }
        assert.equal(args[0], "install");
        assert.equal(
          (await json(packagePath)).dependencies["@fonte-is/nextjs"],
          "0.1.0",
        );
        await writeFile(lockPath, "reconciled legacy dependency\n");
        return 0;
      },
    },
  });
  assert.equal(failedRemoval.exitCode, 1);
  assert.equal(failedRemoval.stderr, "Fonte failed: execution_failed.\n");
  assert.equal(failedRemovalCalls, 2);
  assert.equal(await readFile(packagePath, "utf8"), originalPackageBytes);
  assert.equal(await readFile(lockPath, "utf8"), originalLockBytes);
  assert.equal(await readFile(manifestPath, "utf8"), recordedBytes);
  assert.equal(
    await readFile(path.join(root, "fonte/installation.ts"), "utf8"),
    MANAGED_SOURCE_TEXT,
  );
  const removed = await runProgram(["remove", "--yes", "--json"], request);
  assert.equal(removed.exitCode, 0);
  assert.equal(JSON.parse(removed.stdout).outcome, "removed");
  assert.equal(
    (await json(packagePath)).dependencies["@fonte-is/nextjs"],
    undefined,
  );
  assert.equal(await exists(manifestPath), false);
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
