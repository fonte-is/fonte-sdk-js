import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  assertSanitized,
  baseDependencies,
  batchId,
  collectionArguments,
  config,
  configUrl,
  coreUrl,
  dependencies,
  exclusionReference,
  fingerprint,
  freezeArguments,
  freezeReceipt,
  json,
  reconcileArguments,
  reconciliationReceipt,
  sourceConnection,
  sourceReference,
} from "./fixtures/cli-provider-audience.mjs";

test("provider audience grammar keeps source, exclusions, fingerprint, and help explicit", async () => {
  assert.deepEqual(
    parseArguments(collectionArguments("resend", "--json")).operator,
    {
      kind: "bridge_provider_collections",
      workspace: "northstar",
      environment: "sandbox",
      provider: "resend",
      connectionId: sourceConnection,
    },
  );
  assert.deepEqual(parseArguments(reconcileArguments()).operator, {
    kind: "bridge_provider_reconcile",
    workspace: "northstar",
    environment: "sandbox",
    source: sourceReference(),
    exclusions: [exclusionReference()],
  });
  assert.deepEqual(parseArguments(freezeArguments()).operator, {
    kind: "bridge_provider_freeze",
    workspace: "northstar",
    environment: "sandbox",
    source: sourceReference(),
    exclusions: [exclusionReference()],
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: "freeze-once-5",
  });
  assert.throws(() =>
    parseArguments(
      reconcileArguments().filter((value) => value !== "Suppressed"),
    ),
  );
  for (const argv of [
    ["bridge", "collections", "kit", "--help"],
    ["bridge", "reconcile", "--help"],
    ["bridge", "freeze", "--help"],
  ]) {
    const result = await runProgram(
      argv,
      baseDependencies(async () => json({})),
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Core/);
  }
});

test("collection discovery is one sanitized read through Core custody", async () => {
  const requests = [];
  const result = await runProgram(
    collectionArguments("kit", "--json"),
    dependencies(requests, () =>
      json({
        provider: "kit",
        connectionId: sourceConnection,
        collectionType: "tag",
        observedAt: "2026-08-21T10:00:00.000Z",
        completeness: "complete",
        collections: [{ collectionId: "42", displayName: "Customers" }],
        credential: "provider-secret",
      }),
    ),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(requests[1].init.method, "GET");
  assert.equal(
    requests[1].url,
    `${coreUrl}/v1/workspaces/northstar/bridge/audience/collections/kit/${sourceConnection}?environment=sandbox`,
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(
    receipt.authority.contract_id,
    "fonte.core.provider_audience.v1",
  );
  assert.deepEqual(receipt.result.collections, [
    { collection_id: "42", display_name: "Customers" },
  ]);
  assertSanitized(result.stdout);
});

test("reconcile sends exact references and emits only authoritative aggregates", async () => {
  const requests = [];
  const result = await runProgram(
    [...reconcileArguments(), "--json"],
    dependencies(requests, () => json(reconciliationReceipt())),
  );
  assert.equal(result.exitCode, 0);
  const request = requests[1];
  assert.equal(
    request.url,
    `${coreUrl}/v1/workspaces/northstar/bridge/audience/reconcile?environment=sandbox`,
  );
  assert.equal(request.init.method, "POST");
  assert.equal("idempotency-key" in request.init.headers, false);
  assert.deepEqual(JSON.parse(request.init.body), {
    source: sourceReference(),
    exclusions: [exclusionReference()],
  });
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "provider_audience_reconciliation_ready");
  assert.deepEqual(receipt.result.counts, {
    source: 5,
    exclusion_union: 1,
    protected: 1,
    unknown: 1,
    final: 2,
  });
  assert.equal(receipt.result.observation_fingerprint, fingerprint);
  assertSanitized(result.stdout);
});

test("unavailable inputs remain a no-effect blocked reconciliation", async () => {
  const result = await runProgram(
    [...reconcileArguments(), "--json"],
    baseDependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      return json({
        ...reconciliationReceipt(),
        ready: false,
        observationFingerprint: null,
        source: null,
        unavailableInputs: [
          {
            role: "source",
            index: null,
            reference: sourceReference(),
            reason: "provider_unavailable",
            observedAt: null,
          },
        ],
        counts: null,
        contacts: null,
      });
    }),
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.core_effect, "none");
  assert.equal(
    receipt.result.unavailable_inputs[0].reason,
    "provider_unavailable",
  );
});

test("freeze is an explicit idempotent mutation and lost response stays unknown", async () => {
  const requests = [];
  const completed = await runProgram(
    [...freezeArguments(), "--json"],
    dependencies(requests, () => json(freezeReceipt(), 201)),
  );
  const request = requests[1];
  assert.equal(
    request.url,
    `${coreUrl}/v1/workspaces/northstar/bridge/audience/freeze?environment=sandbox`,
  );
  assert.equal(request.init.headers["idempotency-key"], "freeze-once-5");
  assert.deepEqual(JSON.parse(request.init.body), {
    source: sourceReference(),
    exclusions: [exclusionReference()],
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: "freeze-once-5",
  });
  const receipt = JSON.parse(completed.stdout);
  assert.equal(completed.exitCode, 0);
  assert.equal(receipt.core_effect, "created");
  assert.equal(receipt.result.frozen_audience_id, batchId);
  assert.equal(
    receipt.result.recipient_expression.include[0].contact_import_batch_id,
    batchId,
  );
  assertSanitized(completed.stdout);

  const lost = await runProgram(
    [...freezeArguments(), "--json"],
    baseDependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      throw new Error("response lost");
    }),
  );
  assert.equal(lost.exitCode, 3);
  assert.equal(lost.receipt.reason, "core_api_unavailable");
  assert.equal(lost.receipt.core_effect, "unknown");
});
