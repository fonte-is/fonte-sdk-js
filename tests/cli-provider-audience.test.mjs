import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  assertSanitized,
  baseDependencies,
  batchId,
  collectionArguments,
  contactImportStatusArguments,
  contactImportStatusReceipt,
  config,
  configUrl,
  coreUrl,
  dependencies,
  exclusionReference,
  fingerprint,
  frozenAudienceArguments,
  frozenAudienceReconciliationReceipt,
  frozenAudienceReference,
  freezeArguments,
  freezeReceipt,
  identitySetSha256,
  json,
  reconcileArguments,
  reconciliationReceipt,
  sourceConnection,
  sourceReference,
  protectedReference,
} from "./fixtures/cli-provider-audience.mjs";

test("provider audience grammar keeps source, exclusions, fingerprint, and help explicit", async () => {
  assert.deepEqual(parseArguments(contactImportStatusArguments()).operator, {
    kind: "bridge_contact_import_status",
    workspace: "northstar",
    environment: "sandbox",
    contactImportBatchId: batchId,
  });
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
  assert.deepEqual(
    parseArguments([...freezeArguments(), "--declare-marketing-permission"])
      .operator,
    {
      kind: "bridge_provider_freeze",
      workspace: "northstar",
      environment: "sandbox",
      source: sourceReference(),
      exclusions: [exclusionReference()],
      expectedObservationFingerprint: fingerprint,
      idempotencyKey: "freeze-once-5",
      declaredPermissionBasis: "permission_basis_marketing_claimed",
    },
  );
  assert.throws(() =>
    parseArguments([...reconcileArguments(), "--declare-marketing-permission"]),
  );
  assert.throws(() =>
    parseArguments([
      ...freezeArguments(),
      "--declare-marketing-permission",
      "--declare-marketing-permission",
    ]),
  );
  assert.throws(() =>
    parseArguments(
      reconcileArguments().filter((value) => value !== "Suppressed"),
    ),
  );
  for (const argv of [
    ["bridge", "import", "status", "--help"],
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
    if (argv[1] === "freeze") {
      assert.match(result.stdout, /independent valid marketing permission/);
      assert.match(
        result.stdout,
        /unsubscribe, suppression, and purpose blocks remain authoritative/,
      );
    }
  }
});

test("completed Contact import status supplies the exact frozen reconcile identity", async () => {
  const statusRequests = [];
  const status = await runProgram(
    contactImportStatusArguments("--json"),
    dependencies(statusRequests, () => json(contactImportStatusReceipt())),
  );
  assert.equal(status.exitCode, 0);
  assert.equal(
    statusRequests[1].url,
    `${coreUrl}/v1/broadcast-email/contact-imports`,
  );
  assert.deepEqual(JSON.parse(statusRequests[1].init.body), {
    workspaceSlug: "northstar",
    environment: "sandbox",
    contactImportBatchId: batchId,
  });
  const statusReceipt = JSON.parse(status.stdout);
  assert.deepEqual(statusReceipt.result, {
    kind: "contact_import_status",
    environment: "sandbox",
    status: "completed",
    contact_import_batch_id: batchId,
    identity_set_sha256: identitySetSha256,
  });
  assert.equal(
    statusReceipt.authority.contract_id,
    "fonte.core.contact_import.v1",
  );
  assertSanitized(status.stdout);

  const reconcileRequests = [];
  const reconcile = await runProgram(
    [
      "bridge",
      "reconcile",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--source-import-batch-id",
      statusReceipt.result.contact_import_batch_id,
      "--source-identity-set-sha256",
      statusReceipt.result.identity_set_sha256,
      "--json",
    ],
    dependencies(reconcileRequests, () =>
      json(frozenAudienceReconciliationReceipt(0)),
    ),
  );
  assert.equal(reconcile.exitCode, 0);
  assert.deepEqual(JSON.parse(reconcileRequests[1].init.body).source, {
    kind: "fonte_audience",
    contactImportBatchId: batchId,
    identitySetSha256,
  });

  const human = await runProgram(
    contactImportStatusArguments(),
    dependencies([], () => json(contactImportStatusReceipt())),
  );
  assert.equal(human.exitCode, 0);
  assert.match(human.stdout, new RegExp(batchId));
  assert.match(human.stdout, new RegExp(identitySetSha256));
  assertSanitized(human.stdout);
});

test("nonterminal or incomplete Contact import status never emits a guessed hash", async () => {
  for (const receipt of [
    contactImportStatusReceipt({ status: "pending", identitySetSha256: null }),
    contactImportStatusReceipt({ identitySetSha256: undefined }),
  ]) {
    const result = await runProgram(
      contactImportStatusArguments("--json"),
      dependencies([], () => json(receipt)),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.reason, "core_operator_receipt_invalid");
    assert.equal(result.receipt.core_effect, "none");
    assert.equal(result.receipt.result, null);
    assert.equal(result.stdout.includes(identitySetSha256), false);
    assertSanitized(result.stdout);
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

test("frozen Fonte source carries all 24 explicit exclusions without local evaluation", async () => {
  const requests = [];
  const parsed = parseArguments(frozenAudienceArguments()).operator;
  assert.equal(parsed.kind, "bridge_provider_reconcile");
  assert.deepEqual(parsed.source, frozenAudienceReference());
  assert.deepEqual(
    parsed.exclusions,
    Array.from({ length: 24 }, (_, index) => protectedReference(index)),
  );

  const result = await runProgram(
    [...frozenAudienceArguments(), "--json"],
    dependencies(requests, () => json(frozenAudienceReconciliationReceipt())),
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    source: frozenAudienceReference(),
    exclusions: Array.from({ length: 24 }, (_, index) =>
      protectedReference(index),
    ),
  });
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.result.source, {
    reference: {
      kind: "fonte_audience",
      contact_import_batch_id: batchId,
      identity_set_sha256: "b".repeat(64),
    },
    contacts_observed: 30,
  });
  assert.equal(receipt.result.exclusions.length, 24);
  assert.equal("contacts" in receipt.result, false);
  assertSanitized(result.stdout);

  const freezeRequests = [];
  const frozen = await runProgram(
    [...frozenAudienceArguments("freeze"), "--json"],
    dependencies(freezeRequests, () => json(freezeReceipt(), 201)),
  );
  assert.equal(frozen.exitCode, 0);
  assert.deepEqual(JSON.parse(freezeRequests[1].init.body), {
    source: frozenAudienceReference(),
    exclusions: Array.from({ length: 24 }, (_, index) =>
      protectedReference(index),
    ),
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: "freeze-once-5",
  });
  assert.equal(JSON.parse(frozen.stdout).result.frozen_audience_id, batchId);
  assertSanitized(frozen.stdout);
});

test("frozen Fonte source is exact and mutually exclusive with provider source", () => {
  assert.throws(() =>
    parseArguments([
      ...frozenAudienceArguments("reconcile", 0),
      "--source-provider",
      "resend",
    ]),
  );
  assert.throws(() =>
    parseArguments(
      frozenAudienceArguments("reconcile", 0).filter(
        (value) => value !== "b".repeat(64),
      ),
    ),
  );
  assert.throws(() => parseArguments(frozenAudienceArguments("reconcile", 25)));
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

  const declaredRequests = [];
  const declared = await runProgram(
    [...freezeArguments(), "--declare-marketing-permission", "--json"],
    dependencies(declaredRequests, () => json(freezeReceipt(), 201)),
  );
  assert.deepEqual(JSON.parse(declaredRequests[1].init.body), {
    source: sourceReference(),
    exclusions: [exclusionReference()],
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: "freeze-once-5",
    declaredPermissionBasis: "permission_basis_marketing_claimed",
  });
  assertSanitized(declared.stdout);

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
