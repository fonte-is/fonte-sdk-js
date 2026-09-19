import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  activateArguments,
  activationBinding,
  activatedVersion,
  bearer,
  bound,
  configUrl,
  createArguments,
  definition,
  dependencies,
  hostedConfig,
  json,
  scopeArguments,
  sequenceId,
  sequenceRoute,
  simulateArguments,
  updateArguments,
  withoutOption,
  workspace,
} from "./cli-sequence-authoring-support.mjs";

test("Sequence grammar carries Core-owned definition JSON and stable mutation IDs", () => {
  const parsed = parseArguments(createArguments());
  assert.equal(parsed.command, "operator");
  assert.deepEqual(parsed.operator, {
    kind: "sequence_create",
    workspace,
    environment: "sandbox",
    sequenceId,
    operationKey: "create-welcome",
    definition,
  });
  assert.deepEqual(parseArguments(simulateArguments()).operator, {
    kind: "sequence_simulate",
    workspace,
    environment: "sandbox",
    sequenceId,
    enteredAtMs: 0,
    assumedAcceptedAtMs: { welcome: 0, followup: 172800000 },
  });
  assert.deepEqual(parseArguments(activateArguments()).operator, {
    kind: "sequence_activate",
    workspace,
    environment: "sandbox",
    sequenceId,
    expectedRevision: 2,
    operationKey: "activate-welcome",
    binding: activationBinding(),
  });
  for (const invalid of [
    withoutOption(createArguments(), "--sequence-id"),
    [
      "sequence",
      "read",
      "--workspace",
      workspace,
      "--environment",
      "sandbox",
      "--sequence-id",
      "validate",
    ],
    [
      "sequence",
      "create",
      "--workspace",
      workspace,
      "--environment",
      "sandbox",
      "--sequence-id",
      sequenceId,
      "--operation-key",
      "create-welcome",
      "--definition",
      "[]",
    ],
    [
      "sequence",
      "update",
      "--workspace",
      workspace,
      "--environment",
      "sandbox",
      "--sequence-id",
      sequenceId,
      "--expected-revision",
      "0",
      "--operation-key",
      "update-welcome",
      "--definition",
      JSON.stringify(definition),
    ],
    [
      "sequence",
      "activate",
      ...scopeArguments(),
      "--sequence-id",
      sequenceId,
      "--expected-revision",
      "2",
      "--operation-key",
      "activate-welcome",
      "--binding",
      JSON.stringify({ ...activationBinding(), unknown: true }),
    ],
  ])
    assert.throws(() => parseArguments(invalid));
});

test("Sequence help and invalid invocation stay on the bounded authoring surface", async () => {
  const noCore = async () => {
    throw new Error("help must not request Core");
  };
  const overview = await runProgram(
    ["sequence", "--help"],
    dependencies(noCore),
  );
  assert.equal(overview.exitCode, 0);
  assert.match(overview.stdout, /Fonte sequence commands/);
  assert.match(overview.stdout, /fonte sequence simulate --help/);
  assert.match(overview.stdout, /fonte sequence activate --help/);
  const createHelp = await runProgram(
    ["sequence", "create", "--help"],
    dependencies(noCore),
  );
  assert.equal(createHelp.exitCode, 0);
  assert.match(createHelp.stdout, /caller-owned ID/);
  const invalid = await runProgram(
    ["sequence", "unknown", "--json"],
    dependencies(noCore),
  );
  assert.equal(invalid.exitCode, 2);
  assert.equal(
    JSON.parse(invalid.stdout).next_action.command,
    "fonte sequence --help",
  );
});

test("Sequence authoring and activation use exact Core routes without enrolling or sending", async () => {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.href === configUrl) return json(hostedConfig());
    const request = {
      method: init.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      headers: init.headers,
    };
    requests.push(request);
    return sequenceRoute(request);
  };
  const receipts = [];
  for (const argv of [
    ["sequence", "list", ...scopeArguments()],
    ["sequence", "read", ...scopeArguments(), "--sequence-id", sequenceId],
    createArguments(),
    updateArguments(),
    activateArguments(),
    [
      "sequence",
      "validate",
      ...scopeArguments(),
      "--definition",
      JSON.stringify(definition),
    ],
    [
      "sequence",
      "diff",
      ...scopeArguments(),
      "--sequence-id",
      sequenceId,
      "--base-revision",
      "1",
      "--definition",
      JSON.stringify({ ...definition, title: "A warmer welcome" }),
    ],
    ["sequence", "export", ...scopeArguments(), "--sequence-id", sequenceId],
    simulateArguments(),
  ]) {
    const result = await runProgram(argv, dependencies(fetch));
    assert.equal(result.exitCode, 0, result.stdout || result.stderr);
    receipts.push(JSON.parse(result.stdout));
  }
  assert.deepEqual(
    requests.map(({ method, path }) => ({ method, path })),
    [
      ["GET", "/v1/workspaces/northstar/sequences?environment=sandbox"],
      [
        "GET",
        "/v1/workspaces/northstar/sequences/welcome-sequence?environment=sandbox",
      ],
      ["POST", "/v1/workspaces/northstar/sequences?environment=sandbox"],
      [
        "PUT",
        "/v1/workspaces/northstar/sequences/welcome-sequence?environment=sandbox",
      ],
      [
        "POST",
        "/v1/workspaces/northstar/sequences/welcome-sequence/activate?environment=sandbox",
      ],
      [
        "POST",
        "/v1/workspaces/northstar/sequences/validate?environment=sandbox",
      ],
      [
        "POST",
        "/v1/workspaces/northstar/sequences/welcome-sequence/diff?environment=sandbox",
      ],
      [
        "GET",
        "/v1/workspaces/northstar/sequences/welcome-sequence/export?environment=sandbox",
      ],
      [
        "POST",
        "/v1/workspaces/northstar/sequences/welcome-sequence/simulate?environment=sandbox",
      ],
    ].map(([method, path]) => ({ method, path })),
  );
  assert.deepEqual(requests[2].body, {
    operationKey: "create-welcome",
    sequenceId,
    definition,
  });
  assert.deepEqual(requests[3].body, {
    operationKey: "update-welcome",
    expectedRevision: 1,
    definition: { ...definition, title: "A warmer welcome" },
  });
  assert.deepEqual(requests[4].body, {
    operationKey: "activate-welcome",
    expectedRevision: 2,
    binding: activationBinding(),
  });
  assert.deepEqual(requests[5].body, { definition });
  assert.deepEqual(requests[6].body, {
    baseRevision: 1,
    definition: { ...definition, title: "A warmer welcome" },
  });
  assert.deepEqual(requests[8].body, {
    enteredAtMs: 0,
    assumedAcceptedAtMs: { welcome: 0, followup: 172800000 },
  });
  assert.equal(requests[2].headers["idempotency-key"], "create-welcome");
  assert.equal(requests[3].headers["idempotency-key"], "update-welcome");
  assert.equal(requests[4].headers["idempotency-key"], "activate-welcome");
  assert.equal(receipts[2].reason, "sequence_created");
  assert.equal(receipts[3].reason, "sequence_updated");
  assert.equal(receipts[4].reason, "sequence_activated");
  assert.equal(receipts[4].result.activated_version.version, 1);
  assert.equal(
    receipts[8].result.delivery,
    "not_requested_by_authoring_preview",
  );
  assert.equal(JSON.stringify(receipts).includes(bearer), false);
});

test("Sequence activation preserves Core operation-key replay", async () => {
  const result = await runProgram(
    activateArguments(),
    dependencies(async (input) =>
      String(input) === configUrl
        ? json(hostedConfig())
        : json(
            bound({
              outcome: "replayed",
              sequenceId,
              draftRevision: 2,
              activatedVersion: activatedVersion(),
            }),
          ),
    ),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "sequence_activation_replayed");
  assert.equal(receipt.core_effect, "none");
  assert.equal(receipt.result.outcome, "replayed");
});

test("Sequence revision conflicts are surfaced without a retry instruction", async () => {
  const result = await runProgram(
    updateArguments(),
    dependencies(async (input) =>
      String(input) === configUrl
        ? json(hostedConfig())
        : json({ error: "sequence_draft_revision_conflict" }, 409),
    ),
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "sequence_draft_revision_conflict");
  assert.equal(receipt.core_effect, "none");
  assert.equal("next_action" in receipt, false);
});
