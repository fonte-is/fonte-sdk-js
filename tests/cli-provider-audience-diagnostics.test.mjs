import assert from "node:assert/strict";
import test from "node:test";

import { providerAudienceReconciliation } from "../packages/cli/dist/operator-provider-audience-json.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  assertSanitized,
  dependencies,
  exclusionReference,
  json,
  reconcileArguments,
  reconciliationReceipt,
  sourceReference,
} from "./fixtures/cli-provider-audience.mjs";

test("provider audience diagnostics preserve exact safe values and absent-field compatibility", () => {
  const withoutDiagnostics = providerAudienceReconciliation(
    unavailableReceipt([
      {
        role: "source",
        index: null,
        reference: sourceReference(),
        reason: "provider_unavailable",
        observedAt: null,
      },
    ]),
  );
  assert.deepEqual(
    Object.keys(withoutDiagnostics.unavailable_inputs[0]).sort(),
    ["index", "observed_at", "reason", "reference", "role"],
  );

  const parsed = providerAudienceReconciliation(diagnosticReceipt());
  assert.deepEqual(
    parsed.unavailable_inputs.map((item) => ({
      role: item.role,
      provider_response_invalid_stage: item.provider_response_invalid_stage,
      provider_response_invalid_reason: item.provider_response_invalid_reason,
      provider_unavailable_stage: item.provider_unavailable_stage,
      provider_unavailable_reason: item.provider_unavailable_reason,
    })),
    [
      {
        role: "source",
        provider_response_invalid_stage: "contacts_page",
        provider_response_invalid_reason: "pagination_invalid",
        provider_unavailable_stage: undefined,
        provider_unavailable_reason: undefined,
      },
      {
        role: "exclusion",
        provider_response_invalid_stage: undefined,
        provider_response_invalid_reason: undefined,
        provider_unavailable_stage: "suppressions_page",
        provider_unavailable_reason: "http_rate_limited",
      },
    ],
  );
});

test("provider diagnostics stay sanitized and attributable in JSON and human CLI receipts", async () => {
  const coreReceipt = diagnosticReceipt();
  const jsonResult = await runProgram(
    [...reconcileArguments(), "--json"],
    dependencies([], () => json(coreReceipt)),
  );
  assert.equal(jsonResult.exitCode, 3);
  const jsonReceipt = JSON.parse(jsonResult.stdout);
  const [responseInvalid, providerUnavailable] =
    jsonReceipt.result.unavailable_inputs;
  assert.deepEqual(
    {
      role: responseInvalid.role,
      provider_response_invalid_stage:
        responseInvalid.provider_response_invalid_stage,
      provider_response_invalid_reason:
        responseInvalid.provider_response_invalid_reason,
    },
    {
      role: "source",
      provider_response_invalid_stage: "contacts_page",
      provider_response_invalid_reason: "pagination_invalid",
    },
  );
  assert.equal("provider_unavailable_stage" in responseInvalid, false);
  assert.equal("provider_unavailable_reason" in responseInvalid, false);
  assert.deepEqual(
    {
      role: providerUnavailable.role,
      provider_unavailable_stage:
        providerUnavailable.provider_unavailable_stage,
      provider_unavailable_reason:
        providerUnavailable.provider_unavailable_reason,
    },
    {
      role: "exclusion",
      provider_unavailable_stage: "suppressions_page",
      provider_unavailable_reason: "http_rate_limited",
    },
  );
  assert.equal("provider_response_invalid_stage" in providerUnavailable, false);
  assert.equal(
    "provider_response_invalid_reason" in providerUnavailable,
    false,
  );

  const humanResult = await runProgram(
    reconcileArguments(),
    dependencies([], () => json(coreReceipt)),
  );
  assert.equal(humanResult.exitCode, 3);
  assert.match(
    humanResult.stdout,
    /provider_response_invalid_stage=contacts_page; provider_response_invalid_reason=pagination_invalid/,
  );
  assert.match(
    humanResult.stdout,
    /provider_unavailable_stage=suppressions_page; provider_unavailable_reason=http_rate_limited/,
  );
  for (const output of [jsonResult.stdout, humanResult.stdout]) {
    for (const forbidden of [
      "sensitive-provider-body",
      "hidden-diagnostic@example.test",
      "provider.example.test",
      "provider-credential",
    ]) {
      assert.equal(output.includes(forbidden), false);
    }
    assertSanitized(output);
  }
});

test("unknown provider diagnostic values fail the parser and CLI receipt closed", async () => {
  for (const [field, value] of [
    ["providerResponseInvalidStage", "contact_payload"],
    ["providerResponseInvalidReason", "raw_body_invalid"],
    ["providerUnavailableStage", "provider_url"],
    ["providerUnavailableReason", "provider_message"],
  ]) {
    const coreReceipt = unavailableReceipt([
      {
        role: "source",
        index: null,
        reference: sourceReference(),
        reason: "provider_unavailable",
        observedAt: null,
        [field]: value,
      },
    ]);
    assert.throws(() => providerAudienceReconciliation(coreReceipt));
    const result = await runProgram(
      [...reconcileArguments(), "--json"],
      dependencies([], () => json(coreReceipt)),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.reason, "core_operator_receipt_invalid");
    assert.equal(result.receipt.core_effect, "none");
    assert.equal(result.receipt.result, null);
    assert.equal(result.stdout.includes(value), false);
    assertSanitized(result.stdout);
  }
});

function diagnosticReceipt() {
  return unavailableReceipt([
    {
      role: "source",
      index: null,
      reference: sourceReference(),
      reason: "provider_response_invalid",
      observedAt: null,
      providerResponseInvalidStage: "contacts_page",
      providerResponseInvalidReason: "pagination_invalid",
      providerBody: "sensitive-provider-body",
      contactEmail: "hidden-diagnostic@example.test",
    },
    {
      role: "exclusion",
      index: 0,
      reference: exclusionReference(),
      reason: "provider_unavailable",
      observedAt: null,
      providerUnavailableStage: "suppressions_page",
      providerUnavailableReason: "http_rate_limited",
      requestUrl: "https://provider.example.test/private?credential=secret",
      requestHeaders: { authorization: "Bearer provider-credential" },
    },
  ]);
}

function unavailableReceipt(unavailableInputs) {
  const ready = reconciliationReceipt();
  const unavailableExclusions = new Set(
    unavailableInputs.flatMap((item) =>
      item.role === "exclusion" && item.index !== null ? [item.index] : [],
    ),
  );
  return {
    ...ready,
    ready: false,
    observationFingerprint: null,
    source: unavailableInputs.some((item) => item.role === "source")
      ? null
      : ready.source,
    exclusions: ready.exclusions.filter(
      (item) => !unavailableExclusions.has(item.index),
    ),
    unavailableInputs,
    counts: null,
    contacts: null,
  };
}
