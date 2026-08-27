import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";
import {
  application,
  applicationFile,
  applicationId,
  args,
  assertAggregateOnly,
  coreUrl,
  dependencies,
  incomingBatchId,
  json,
  outgoingBatchId,
  receipt,
} from "./fixtures/cli-provider-placement-application.mjs";

test("placement apply and progress use the exact aggregate application binding", async () => {
  assert.deepEqual(parseArguments(args("apply")).operator, {
    kind: "bridge_provider_placement_apply",
    workspace: "northstar",
    environment: "production",
    applicationFile,
  });
  assert.match(
    (
      await runProgram(
        ["bridge", "placement", "apply", "--help"],
        dependencies([], () => json({})),
      )
    ).stdout,
    /never retries automatically/,
  );

  const applyRequests = [];
  const apply = await runProgram(
    args("apply"),
    dependencies(applyRequests, () => json(receipt("partial"))),
  );
  assert.equal(apply.exitCode, 3);
  assert.equal(apply.receipt.outcome, "blocked");
  assert.equal(apply.receipt.reason, "application_remaining");
  assert.equal(apply.receipt.core_effect, "unknown");
  assert.equal(
    apply.receipt.authority.contract_id,
    "fonte.core.provider_placement_application.v1",
  );
  assert.equal(applyRequests.length, 2);
  assert.equal(
    applyRequests[1].url,
    `${coreUrl}/v1/workspaces/northstar/bridge/audience/placement-apply?environment=production`,
  );
  assert.equal(applyRequests[1].init.method, "POST");
  assert.equal(applyRequests[1].init.headers["idempotency-key"], applicationId);
  assert.deepEqual(JSON.parse(applyRequests[1].init.body), application());
  assertAggregateOnly(apply.stdout);

  const progressRequests = [];
  const progress = await runProgram(
    args("progress"),
    dependencies(progressRequests, () => json(receipt("complete"))),
  );
  assert.equal(progress.exitCode, 0);
  assert.equal(progress.receipt.outcome, "completed");
  assert.equal(progress.receipt.core_effect, "none");
  assert.equal(progressRequests.length, 2);
  assert.equal(progressRequests[1].init.method, "GET");
  assert.equal(progressRequests[1].init.body, undefined);
  assert.equal(
    progressRequests[1].url,
    `${coreUrl}/v1/workspaces/northstar/bridge/audience/placement-progress?environment=production&idempotencyKey=${applicationId}`,
  );
  assert.deepEqual(progress.receipt.result.outgoing, {
    contact_import_batch_id: outgoingBatchId,
    source_checksum_sha256: "3".repeat(64),
    identity_set_sha256: "4".repeat(64),
    count: 2,
    confirmed: 2,
    remaining: 0,
  });
  assert.deepEqual(progress.receipt.result.incoming, {
    contact_import_batch_id: incomingBatchId,
    source_checksum_sha256: "5".repeat(64),
    identity_set_sha256: "6".repeat(64),
    count: 2,
    confirmed: 2,
    remaining: 0,
  });
  assert.deepEqual(progress.receipt.result.retirement_certificate, {
    certificate_id: application().retirementCertificate.certificateId,
    certificate_checksum_sha256:
      application().retirementCertificate.certificateChecksumSha256,
  });
  assertAggregateOnly(progress.stdout);
});

test("malformed input and mismatched readback fail closed without recipient disclosure", async () => {
  let calls = 0;
  let authorizations = 0;
  const malformed = await runProgram(
    args("apply"),
    dependencies(
      [],
      () => {
        calls += 1;
        return json({});
      },
      { ...application(), recipients: ["hidden@example.test"] },
      () => {
        authorizations += 1;
      },
    ),
  );
  assert.equal(
    malformed.receipt.reason,
    "provider_placement_application_request_invalid",
  );
  assert.equal(calls, 0);
  assert.equal(authorizations, 0);
  assertAggregateOnly(malformed.stdout);

  for (const response of [
    {
      ...receipt("complete"),
      workspaceId: "10000000-0000-4000-8000-000000000698",
    },
    {
      ...receipt("complete"),
      connectionId: "10000000-0000-4000-8000-000000000699",
    },
    {
      ...receipt("complete"),
      contacts: [{ normalizedEmail: "hidden@example.test" }],
    },
  ]) {
    const result = await runProgram(
      args("progress"),
      dependencies([], () => json(response)),
    );
    assert.equal(result.receipt.reason, "core_operator_receipt_invalid");
    assert.equal(result.receipt.core_effect, "none");
    assertAggregateOnly(result.stdout);
  }
});

test("ambiguous apply performs one Core request and requires explicit GET recovery", async () => {
  const requests = [];
  const ambiguous = await runProgram(
    args("apply"),
    dependencies(requests, () => {
      throw new Error("response lost");
    }),
  );
  assert.equal(ambiguous.receipt.reason, "core_api_unavailable");
  assert.equal(ambiguous.receipt.core_effect, "unknown");
  assert.equal(requests.length, 2);

  const recovery = await runProgram(
    args("progress"),
    dependencies([], () => json(receipt("partial"))),
  );
  assert.equal(recovery.receipt.reason, "application_remaining");
  assert.equal(recovery.receipt.core_effect, "none");
});
