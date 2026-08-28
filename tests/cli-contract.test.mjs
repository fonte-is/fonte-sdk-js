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
  assert.equal(manifest.version, "0.2.0");
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
  assert.match(USAGE_TEXT, /fonte provider-evidence resend <command>/);
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

test("invalid JSON calls stay private and every current command help matches its authority", async () => {
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
  for (const argv of [
    ["test", "untrusted-secret-token", "--json"],
    ["broadcast", "draft", "create", "/private/credential", "--json"],
    ["bridge", "observe", "resend", "token-like-value", "--json"],
  ]) {
    const result = await runProgram(argv, dependencies);
    const receipt = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 2);
    assert.equal(receipt.detail.field, "invocation");
    assert.equal(result.stdout.includes(argv.at(-2)), false);
  }
  for (const [argv, expected] of [
    [["init", "--help"], "[--yes] [--json]"],
    [["doctor", "--help"], "Usage: fonte doctor [--json]"],
    [["test", "--help"], "hosted sandbox proof"],
    [["auth", "--help"], "fonte auth exec --help"],
    [["auth", "exec", "--help"], "bearer-bound child"],
    [["remove", "--help"], "Fonte-owned local installation state"],
    [["broadcast", "--help"], "Fonte broadcast commands"],
    [["broadcast", "draft", "--help"], "broadcast draft create --help"],
    [["broadcast", "audience", "--help"], "broadcast audience options --help"],
    [["broadcast", "test", "--help"], "broadcast test send --help"],
    [["broadcast", "draft", "create", "--help"], "--title <title>"],
    [["broadcast", "draft", "read", "--help"], "--draft-id <uuid>"],
    [["broadcast", "audience", "options", "--help"], "audience source IDs"],
    [["broadcast", "audience", "preview", "--help"], "eligible counts"],
    [["broadcast", "test", "send", "--help"], "--environment sandbox"],
    [["broadcast", "test", "status", "--help"], "--environment production"],
    [["broadcast", "preflight", "--help"], "--expected-version <n>"],
    [["broadcast", "authorize", "--help"], "--idempotency-key <key>"],
    [["broadcast", "status", "--help"], "[--watch]"],
    [["broadcast", "pause", "--help"], "state-idempotent"],
    [["broadcast", "resume", "--help"], "state-idempotent"],
    [["broadcast", "cancel", "--help"], "state-idempotent"],
    [["broadcast", "result", "--help"], "frozen audience provenance"],
    [["bridge", "observe", "resend", "--help"], "Resend segment"],
    [["bridge", "copy", "resend", "--help"], "fingerprint-bound"],
    [["bridge", "--help"], "bridge observe resend --help"],
    [["bridge", "observe", "--help"], "bridge observe kit --help"],
    [["bridge", "copy", "--help"], "bridge copy kit --help"],
    [["broadcast", "prepare", "--help"], "unsupported_authority"],
    [["bridge", "status", "--help"], "unsupported_authority"],
    [["provider-evidence", "--help"], "provider-evidence resend start --help"],
    [["provider-evidence", "resend", "--help"], "generation read --help"],
    [
      ["provider-evidence", "resend", "start", "--help"],
      "--candidates-file <json-file>",
    ],
    [
      ["provider-evidence", "resend", "read", "--help"],
      "Read this before every advance",
    ],
    [
      ["provider-evidence", "resend", "advance", "--help"],
      "never retries automatically",
    ],
    [
      ["provider-evidence", "resend", "seal", "--help"],
      "--generation-id <uuid>",
    ],
    [
      ["provider-evidence", "resend", "generation", "read", "--help"],
      "seal checksums",
    ],
  ]) {
    const result = await runProgram(argv, dependencies);
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stdout,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  const productionTestHelp = await runProgram(
    ["broadcast", "test", "send", "--help"],
    dependencies,
  );
  assert.match(productionTestHelp.stdout, /--environment sandbox/);
  assert.match(productionTestHelp.stdout, /--environment production/);
  assert.match(productionTestHelp.stdout, /--postal-address <address>/);
  assert.match(productionTestHelp.stdout, /--text-body <text>/);
  assert.match(productionTestHelp.stdout, /--html-body <html>/);
  const contract = await readFile(
    path.join(root, "packages/cli/CONTRACT.md"),
    "utf8",
  );
  assert.match(contract, /fonte\.cli\.invalid_invocation\.v1/);
  assert.match(
    contract,
    /Unknown positional values, paths, and token-like input/,
  );
  const operatorContract = await readFile(
    path.join(root, "packages/cli/OPERATOR_CONTRACT.md"),
    "utf8",
  );
  assert.match(
    operatorContract,
    /Core intentionally denies CLI OAuth `PUT` and `PATCH`/,
  );
  assert.match(
    operatorContract,
    /replacement\n+draft with a new UUID idempotency key/,
  );
  assert.match(
    operatorContract,
    /authoritative audience\n+preview, verified-account test, and exact-revision preflight/,
  );
  assert.match(operatorContract, /Candidate-scoped Resend evidence/);
  assert.match(operatorContract, /CLI adds no retry loop/);
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
