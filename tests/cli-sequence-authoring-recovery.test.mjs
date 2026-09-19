import assert from "node:assert/strict";
import test from "node:test";

import { runProgram } from "../packages/cli/dist/program.js";
import {
  activateArguments,
  bound,
  createArguments,
  definition,
  dependencies,
  hostedConfig,
  json,
  plan,
  scopeArguments,
  sequence,
  sequenceId,
  configUrl,
} from "./cli-sequence-authoring-support.mjs";

test("ambiguous Sequence mutations produce one readback instruction and never retry", async () => {
  let calls = 0;
  const result = await runProgram(
    createArguments(),
    dependencies(async (input) => {
      calls += 1;
      if (String(input) === configUrl) return json(hostedConfig());
      throw new Error("response lost after Core may have persisted the draft");
    }),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(calls, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
  assert.deepEqual(receipt.next_action, readback());
});

test("malformed successful Sequence mutation receipts are recovered by readback", async () => {
  let calls = 0;
  const result = await runProgram(
    createArguments(),
    dependencies(async (input) => {
      calls += 1;
      return String(input) === configUrl
        ? json(hostedConfig())
        : json(bound({ outcome: "applied", sequence: { sequenceId } }), 201);
    }),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(calls, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "core_operator_receipt_invalid");
  assert.equal(receipt.core_effect, "unknown");
  assert.deepEqual(receipt.next_action, readback());
});

test("ambiguous Sequence activation stays unknown without an invented readback", async () => {
  let calls = 0;
  const result = await runProgram(
    activateArguments(),
    dependencies(async (input) => {
      calls += 1;
      if (String(input) === configUrl) return json(hostedConfig());
      throw new Error("response lost after Core may have activated a version");
    }),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(calls, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal("next_action" in receipt, false);
});

test("malformed successful Sequence activation stays unknown without a retry", async () => {
  let calls = 0;
  const result = await runProgram(
    activateArguments(),
    dependencies(async (input) => {
      calls += 1;
      return String(input) === configUrl
        ? json(hostedConfig())
        : json(
            bound({
              outcome: "activated",
              sequenceId,
              draftRevision: 2,
              activatedVersion: {},
            }),
            201,
          );
    }),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(calls, 2);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "core_operator_receipt_invalid");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal("next_action" in receipt, false);
});

test("Sequence reads preserve Core-valid plan text without CLI-only caps", async () => {
  const longTitle = "T".repeat(600);
  const longStepId = "s".repeat(300);
  const longSubject = "S".repeat(6_000);
  const longDefinition = {
    ...definition,
    title: longTitle,
    steps: [
      { ...definition.steps[0], id: longStepId, subject: longSubject },
      ...definition.steps.slice(1),
    ],
  };
  const longPlan = {
    ...plan(),
    title: longTitle,
    steps: [
      { ...plan().steps[0], stepId: longStepId, subject: longSubject },
      ...plan().steps.slice(1),
    ],
  };
  const result = await runProgram(
    ["sequence", "read", ...scopeArguments(), "--sequence-id", sequenceId],
    dependencies(async (input) =>
      String(input) === configUrl
        ? json(hostedConfig())
        : json(
            bound({
              sequence: {
                ...sequence(1),
                definition: longDefinition,
                plan: longPlan,
              },
            }),
          ),
    ),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.result.plan.title, longTitle);
  assert.equal(receipt.result.plan.steps[0].step_id, longStepId);
  assert.equal(receipt.result.plan.steps[0].subject, longSubject);
});

function readback() {
  return {
    kind: "run_command",
    command:
      "fonte sequence read --workspace northstar --environment sandbox --sequence-id welcome-sequence --json",
    retry_mutation: false,
  };
}
