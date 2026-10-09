import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readJson, root, run } from "./workspace-utils.mjs";

const packs = path.join(root, ".artifacts", "packs");
const report = readJson(path.join(packs, "pack-report.json"));
const cliManifest = readJson(path.join(root, "packages/cli/package.json"));
const cliVersion = cliManifest.version;
const fixture = await mkdtemp(path.join(os.tmpdir(), "fonte-packed-cli-"));

try {
  await writeFile(
    path.join(fixture, "package.json"),
    '{"name":"packed-cli-smoke","private":true}\n',
  );
  const tarballs = report.packages.map(({ filename }) =>
    path.join(packs, filename),
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--legacy-peer-deps",
      ...tarballs,
    ],
    { cwd: fixture },
  );
  await writeProject(fixture);

  const cli = path.join(fixture, "node_modules/@fonte-is/cli/dist/main.js");
  assert.equal(
    run(process.execPath, [cli, "--version"], { cwd: fixture, capture: true }),
    `@fonte-is/cli ${cliVersion}\n`,
  );
  const connectionHelp = run(process.execPath, [cli, "connections", "--help"], {
    cwd: fixture,
    capture: true,
  });
  assert.match(connectionHelp, /--choice-ref <ref>/);
  assert.match(connectionHelp, /--connection-ref <ref>/);
  const reconcileHelp = run(
    process.execPath,
    [cli, "audience", "reconcile", "--help"],
    { cwd: fixture, capture: true },
  );
  assert.match(reconcileHelp, /--contact-import-batch-id <uuid>/);
  assert.match(reconcileHelp, /--identity-set-sha256 <sha256>/);
  await assertFonteAudienceSource(fixture);
  assert.equal(
    receipt(cli, fixture, ["init", "--yes", "--json"]).outcome,
    "applied",
  );
  const localManifestPath = path.join(fixture, ".fonte/installation.json");
  const localManifest = JSON.parse(await readFile(localManifestPath, "utf8"));
  assert.equal(localManifest.cli_version, cliVersion);
  assert.equal(receipt(cli, fixture, ["doctor", "--json"]).outcome, "verified");
  for (const compatibleVersion of [
    "0.1.0",
    "0.1.1",
    "0.1.2",
    "0.1.3",
    "0.1.4",
    "0.3.4",
    "0.3.5",
  ]) {
    localManifest.cli_version = compatibleVersion;
    await writeFile(
      localManifestPath,
      `${JSON.stringify(localManifest, null, 2)}\n`,
    );
    assert.equal(
      receipt(cli, fixture, ["doctor", "--json"]).outcome,
      "verified",
    );
  }
  assert.equal(
    receipt(cli, fixture, ["remove", "--yes", "--json"]).outcome,
    "removed",
  );

  const deepImport = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "import('@fonte-is/cli/program')"],
    {
      cwd: fixture,
      encoding: "utf8",
    },
  );
  assert.notEqual(
    deepImport.status,
    0,
    "unsupported CLI deep import must fail",
  );
  assert.match(deepImport.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);

  const nodeFloor = run("npx", ["--yes", "node@20.9.0", cli, "--version"], {
    cwd: fixture,
    capture: true,
  });
  assert.equal(nodeFloor, `@fonte-is/cli ${cliVersion}\n`);
  console.log(
    JSON.stringify({
      ok: true,
      lifecycle: ["version", "init", "doctor", "remove"],
      manifestVersions: {
        created: cliVersion,
        compatible: [
          "0.1.0",
          "0.1.1",
          "0.1.2",
          "0.1.3",
          "0.1.4",
          "0.3.4",
          "0.3.5",
        ],
      },
      packedConnectionCommands: true,
      packedFonteAudienceSource: true,
      nodeFloor: "20.9.0",
    }),
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function assertFonteAudienceSource(fixture) {
  const installed = path.join(fixture, "node_modules/@fonte-is/cli/dist");
  const { createCoreOperatorClient } = await import(
    pathToFileURL(path.join(installed, "operator-client.js")).href
  );
  const contactImportBatchId = "10000000-0000-4000-8000-000000000503";
  const identitySetSha256 = "b".repeat(64);
  const input = {
    workspace: "northstar",
    environment: "sandbox",
    source: {
      kind: "fonte_audience",
      contactImportBatchId,
      identitySetSha256,
    },
    exclusionSourceRefs: [],
  };

  const requests = [];
  const client = createCoreOperatorClient({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic-bearer",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          ready: true,
          observationFingerprint: "a".repeat(64),
          exclusions: [],
          unavailableInputs: [],
          counts: {
            source: 1,
            exclusionUnion: 0,
            protected: 0,
            unknown: 0,
            final: 1,
          },
          contacts: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await client.reconcileAudience(input);
  assert.equal(
    requests[0].url,
    "https://api.example.test/v1/workspaces/northstar/connected-audience/reconcile?environment=sandbox",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body).source, input.source);
}

function receipt(cli, cwd, arguments_) {
  return JSON.parse(
    run(process.execPath, [cli, ...arguments_], { cwd, capture: true }),
  );
}

async function writeProject(directory) {
  const manifest = {
    name: "packed-cli-smoke",
    private: true,
    packageManager: "npm@10.9.2",
    dependencies: {
      "@fonte-is/cli": cliVersion,
      "@fonte-is/nextjs": "0.1.0",
      next: "16.2.11",
      react: "19.2.0",
      "react-dom": "19.2.0",
    },
  };
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await mkdir(path.join(directory, "app"));
  await writeFile(
    path.join(directory, "app/layout.tsx"),
    "export default null;\n",
  );
  await writeFile(path.join(directory, ".gitignore"), "node_modules\n");
  assert.ok(
    (await readFile(path.join(directory, "package-lock.json"))).byteLength > 0,
  );
}
