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
  for (const operation of ["connect", "reconnect"]) {
    const resendHelp = run(
      process.execPath,
      [cli, "bridge", "connections", operation, "resend", "--help"],
      { cwd: fixture, capture: true },
    );
    assert.match(resendHelp, /native Resend OAuth/);
    const kitHelp = run(
      process.execPath,
      [cli, "bridge", "connections", operation, "kit", "--help"],
      { cwd: fixture, capture: true },
    );
    assert.match(kitHelp, /Kit OAuth is currently unavailable/);
  }
  const reconcileHelp = run(
    process.execPath,
    [cli, "bridge", "reconcile", "--help"],
    { cwd: fixture, capture: true },
  );
  assert.match(reconcileHelp, /--source-import-batch-id <uuid>/);
  assert.match(reconcileHelp, /--source-identity-set-sha256 <sha256>/);
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
        compatible: ["0.1.0", "0.1.1", "0.1.2", "0.1.3", "0.1.4"],
      },
      packedProviderOAuthCommands: true,
      packedFonteAudienceSource: true,
      nodeFloor: "20.9.0",
    }),
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}

async function assertFonteAudienceSource(fixture) {
  const installed = path.join(fixture, "node_modules/@fonte-is/cli/dist");
  const { parseArguments } = await import(
    pathToFileURL(path.join(installed, "arguments.js")).href
  );
  const { createCoreOperatorClient } = await import(
    pathToFileURL(path.join(installed, "operator-client.js")).href
  );
  const contactImportBatchId = "10000000-0000-4000-8000-000000000503";
  const identitySetSha256 = "b".repeat(64);
  const operator = parseArguments([
    "bridge",
    "reconcile",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--source-import-batch-id",
    contactImportBatchId,
    "--source-identity-set-sha256",
    identitySetSha256,
  ]).operator;
  assert.deepEqual(operator.source, {
    kind: "fonte_audience",
    contactImportBatchId,
    identitySetSha256,
  });

  const requests = [];
  const client = createCoreOperatorClient({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic-bearer",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          workspaceId: "10000000-0000-4000-8000-000000000504",
          environment: "sandbox",
          ready: true,
          observationFingerprint: "a".repeat(64),
          source: {
            reference: operator.source,
            observedAt: "2026-08-21T09:55:00.000Z",
            contactsObserved: 1,
            coverage: { status: "complete", pagesObserved: 1 },
          },
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
  await client.reconcileProviderAudience(operator);
  assert.equal(
    requests[0].url,
    "https://api.example.test/v1/workspaces/northstar/bridge/audience/reconcile?environment=sandbox",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body).source, operator.source);
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
