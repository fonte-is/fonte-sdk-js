import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  assert.equal(
    receipt(cli, fixture, ["init", "--yes", "--json"]).outcome,
    "applied",
  );
  const localManifestPath = path.join(fixture, ".fonte/installation.json");
  const localManifest = JSON.parse(await readFile(localManifestPath, "utf8"));
  assert.equal(localManifest.cli_version, cliVersion);
  assert.equal(receipt(cli, fixture, ["doctor", "--json"]).outcome, "verified");
  for (const compatibleVersion of ["0.1.0", "0.1.1", "0.1.2"]) {
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
        compatible: ["0.1.0", "0.1.1", "0.1.2"],
      },
      nodeFloor: "20.9.0",
    }),
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
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
