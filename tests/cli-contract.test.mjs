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
  assert.equal(manifest.version, "0.1.1");
  assert.deepEqual(manifest.bin, { fonte: "./dist/main.js" });
  assert.deepEqual(manifest.dependencies, { "openid-client": "6.8.5" });
  assert.deepEqual(manifest.exports, {
    "./operator-client": {
      types: "./dist/operator-client.d.ts",
      import: "./dist/operator-client.js",
    },
  });
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
  assert.deepEqual(
    parseArguments(["test", "--json", "--workspace", "my-workspace"]),
    {
      command: "test",
      apply: false,
      json: true,
      workspaceSlug: "my-workspace",
    },
  );
  assert.deepEqual(
    parseArguments(["auth", "exec", "--", "npm", "run", "local:core"]),
    {
      command: "auth-exec",
      apply: false,
      json: false,
      consumerCommand: "npm",
      consumerArguments: ["run", "local:core"],
    },
  );
  for (const argv of [
    [],
    ["doctor", "--yes"],
    ["init", "--yes", "--yes"],
    ["init", "--unknown"],
    ["--help", "init"],
    ["test"],
    ["test", "--workspace", "UPPERCASE"],
    ["test", "--workspace", "my-workspace", "--workspace", "other"],
    ["auth"],
    ["auth", "exec"],
    ["auth", "exec", "npm"],
    ["auth", "exec", "--"],
  ]) {
    assert.throws(() => parseArguments(argv), { name: "Error" });
  }
});

test("help, version, and usage bytes are literal public contracts", async () => {
  assert.match(HELP_TEXT, /^Fonte local installation CLI\./);
  assert.equal(HELP_TEXT.endsWith("\n"), true);
  assert.equal(USAGE_TEXT.endsWith("\n"), true);
  const manifest = JSON.parse(
    await readFile(path.join(root, "packages/cli/package.json"), "utf8"),
  );
  assert.equal(VERSION_TEXT, `@fonte-is/cli ${manifest.version}\n`);
  assert.match(USAGE_TEXT, /fonte auth exec -- <command> \[args\.\.\.\]/);
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

test("invalid JSON calls keep a structured receipt and production help exposes recovery", async () => {
  const dependencies = {
    cwd: root,
    randomUUID: () => "10000000-0000-4000-8000-000000000009",
    runner: { run: async () => 1 },
  };
  const invalid = await runProgram(
    ["broadcast", "draft", "create", "--json"],
    dependencies,
  );
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.stderr, "");
  assert.deepEqual(JSON.parse(invalid.stdout), {
    schema_version: "fonte.cli.invalid_invocation.v1",
    command: "invalid_invocation",
    outcome: "invalid_invocation",
    reason: "invalid_invocation",
    detail: {
      code: "invalid_operator_arguments",
      kind: "missing_field",
      field: "--environment",
    },
    next_action: {
      kind: "run_command",
      command: "fonte broadcast draft create --help",
    },
  });
  for (const [argv, expected] of [
    [["broadcast", "draft", "--help"], "broadcast draft create --help"],
    [["broadcast", "audience", "preview", "--help"], "--draft-id <uuid>"],
    [["broadcast", "test", "--help"], "broadcast test status --help"],
    [["broadcast", "preflight", "--help"], "--expected-version <n>"],
    [["broadcast", "authorize", "--help"], "--idempotency-key <key>"],
    [["broadcast", "status", "--help"], "[--watch]"],
    [["broadcast", "pause", "--help"], "state-idempotent"],
    [["broadcast", "resume", "--help"], "state-idempotent"],
    [["broadcast", "cancel", "--help"], "state-idempotent"],
    [["broadcast", "result", "--help"], "frozen audience provenance"],
  ]) {
    const result = await runProgram(argv, dependencies);
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  const contract = await readFile(
    path.join(root, "packages/cli/OPERATOR_CONTRACT.md"),
    "utf8",
  );
  assert.match(
    contract,
    /Core intentionally denies CLI OAuth `PUT` and `PATCH`/,
  );
  assert.match(contract, /replacement\n+draft with a new UUID idempotency key/);
  assert.match(
    contract,
    /authoritative audience\n+preview, verified-account test, and exact-revision preflight/,
  );
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
