import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { canonicalJson } from "../packages/cli/dist/canonical-json.js";
import {
  HELP_TEXT,
  MANAGED_SOURCE_TEXT,
  SDK_PACKAGE,
  SDK_VERSION,
  USAGE_TEXT,
  VERSION_TEXT,
} from "../packages/cli/dist/constants.js";
import { sealPlan } from "../packages/cli/dist/plan.js";
import { plannedReceipt } from "../packages/cli/dist/receipts.js";
import { renderHuman, renderJson } from "../packages/cli/dist/render.js";
import { runProgram } from "../packages/cli/dist/program.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("CLI package identity stays independent from the fonte binary", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "packages/cli/package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@fonte-is/cli");
  assert.deepEqual(manifest.bin, { fonte: "./dist/main.js" });
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(manifest.exports, undefined);
});

test("argument grammar has no implicit confirmation or extra flags", () => {
  assert.deepEqual(parseArguments(["init"]), {
    command: "init",
    apply: false,
    json: false,
  });
  assert.deepEqual(parseArguments(["remove", "--json", "--yes"]), {
    command: "remove",
    apply: true,
    json: true,
  });
  assert.deepEqual(parseArguments(["doctor", "--json"]), {
    command: "doctor",
    apply: false,
    json: true,
  });
  for (const argv of [
    [],
    ["doctor", "--yes"],
    ["init", "--yes", "--yes"],
    ["init", "--unknown"],
    ["--help", "init"],
  ]) {
    assert.throws(() => parseArguments(argv), { name: "Error" });
  }
});

test("help, version, and usage bytes are literal public contracts", () => {
  assert.match(HELP_TEXT, /^Fonte local installation CLI\./);
  assert.equal(HELP_TEXT.endsWith("\n"), true);
  assert.equal(USAGE_TEXT.endsWith("\n"), true);
  assert.equal(VERSION_TEXT, "@fonte-is/cli 0.1.0\n");
});

test("program renders help, version, and invalid invocation exactly", async () => {
  const dependencies = {
    cwd: root,
    randomUUID: () => "10000000-0000-4000-8000-000000000009",
    runner: { run: async () => 1 },
  };
  assert.deepEqual(await runProgram(["--help"], dependencies), {
    exitCode: 0,
    stdout: HELP_TEXT,
    stderr: "",
  });
  assert.deepEqual(await runProgram(["--version"], dependencies), {
    exitCode: 0,
    stdout: VERSION_TEXT,
    stderr: "",
  });
  assert.deepEqual(await runProgram([], dependencies), {
    exitCode: 2,
    stdout: "",
    stderr: USAGE_TEXT,
  });
});

test("plan sealing uses recursively canonical compact JSON", () => {
  assert.equal(
    canonicalJson({ z: "Ź", a: [{ y: 2, x: true }] }),
    '{"a":[{"x":true,"y":2}],"z":"Ź"}',
  );
  const material = {
    schema_version: "fonte.cli.plan.v1",
    command: "init",
    adapter_id: "next_app_router",
    adapter_version: "v1",
    package_manager: "npm",
    sdk_package: SDK_PACKAGE,
    sdk_version: SDK_VERSION,
    operations: [
      {
        id: "installation_module",
        kind: "create_file",
        path: "fonte/installation.ts",
        action: "create",
      },
    ],
  };
  const plan = sealPlan(material);
  assert.match(plan.plan_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(sealPlan(material), plan);
});

test("planned receipts make the unavailable product boundary explicit", () => {
  const plan = sealPlan({
    schema_version: "fonte.cli.plan.v1",
    command: "init",
    adapter_id: "next_app_router",
    adapter_version: "v1",
    package_manager: "npm",
    sdk_package: SDK_PACKAGE,
    sdk_version: SDK_VERSION,
    operations: [
      {
        id: "installation_module",
        kind: "create_file",
        path: "fonte/installation.ts",
        action: "create",
      },
    ],
  });
  const receipt = plannedReceipt(plan);
  assert.equal(receipt.provider_effect, "none");
  assert.equal(receipt.application_email, "unavailable");
  assert.equal(receipt.account_created, false);
  assert.equal(
    renderHuman(receipt),
    "Fonte init plan: 1 change.\nNo files changed.\nRun npx @fonte-is/cli init --yes to apply.\n",
  );
  assert.equal(renderJson(receipt), `${JSON.stringify(receipt)}\n`);
  assert.equal(MANAGED_SOURCE_TEXT.endsWith("\n"), true);
});
