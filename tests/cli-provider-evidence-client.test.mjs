import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreOperatorError,
  createCoreOperatorClient,
} from "../packages/cli/dist/operator-client.js";

const operationId = "10000000-0000-4000-8000-000000000247";
const generationId = "20000000-0000-4000-8000-000000000247";
const connectionId = "30000000-0000-4000-8000-000000000247";
const selectorGenerationId = "40000000-0000-4000-8000-000000000247";
const candidateCount = 69_987;
const selector = {
  selectorId: "sealed-selector-v1",
  selectorGenerationId,
  artifactSha256: "a".repeat(64),
  identitySetSha256: "b".repeat(64),
  candidateCount,
  candidateManifestSha256: "c".repeat(64),
};

test("official client binds the exact 69,987 selector and exposes only aggregate receipts", async () => {
  const requests = [];
  const responses = [
    operationReceipt(), operationReceipt(), operationReceipt(),
    generationReceipt(), generationReceipt(),
  ];
  const client = createCoreOperatorClient({
    coreApiBaseUrl: "https://core.example.test",
    bearer: "synthetic.operator.token",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse(responses.shift());
    },
  });
  const candidates = Array.from({ length: candidateCount }, (_, index) => ({
    providerRecordId: `synthetic-provider-record-${index + 1}`,
    identityFingerprintSha256: (index + 1).toString(16).padStart(64, "0"),
  }));
  const scope = {
    workspace: "evidence-proof", environment: "production", connectionId, selector,
  };
  const started = await client.startResendCandidateEvidence({
    ...scope, operationId, candidates,
    schemaVersion: "resend_candidate_evidence_v1",
    normalizationVersion: "resend_candidate_normalization_v1",
    identityFingerprintVersion: "tenant_hmac_sha256_v1",
    identityCustody: {
      emailAddressKeyId: "synthetic-key-v1",
      emailNormalizationVersion: 1,
    },
  });
  const advanced = await client.advanceResendCandidateEvidence({
    ...scope, operationId, expectedRequestNumber: started.next_request_number,
  });
  const progress = await client.readResendCandidateEvidence({ ...scope, operationId });
  const sealed = await client.sealResendCandidateEvidence({
    ...scope, operationId, generationId,
  });
  const generation = await client.readResendCandidateEvidenceGeneration({
    ...scope, generationId,
  });

  const startRequest = requests[0];
  assert.equal(startRequest.init.method, "POST");
  assert.equal(startRequest.url,
    "https://core.example.test/v1/workspaces/evidence-proof/provider-evidence/resend/candidate-acquisitions?environment=production");
  const startBody = JSON.parse(startRequest.init.body);
  assert.equal(startBody.candidates.length, candidateCount);
  assert.deepEqual(startBody.selector, selector);
  assert.ok(Buffer.byteLength(startRequest.init.body) < 32 * 1_048_576);

  assert.match(requests[1].url, new RegExp(`${operationId}/requests\\?environment=production$`));
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    ...guard(), expectedRequestNumber: 1,
  });
  assert.equal(requests[1].init.headers["idempotency-key"], `${operationId}:1`);
  assert.equal(requests[2].init.method, "GET");
  assert.equal(requests[2].init.body, undefined);
  assert.match(requests[2].url, /selectorGenerationId=/);
  assert.deepEqual(JSON.parse(requests[3].init.body), { generationId, ...guard() });
  assert.match(requests[4].url, /candidate-generations/);

  for (const result of [started, advanced, progress, sealed, generation]) {
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("synthetic-provider-record"), false);
    assert.equal(serialized.includes("candidates"), false);
    assert.equal(serialized.includes("rows"), false);
    assert.equal(serialized.includes("nextCursor"), false);
  }
  assert.equal(started.selector.candidate_count, candidateCount);
  assert.deepEqual(started.authority, {
    provider: "resend", provider_access: "candidate_scoped_get_only",
    provider_mutation: "not_granted", contact_mutation: "not_granted",
  });
  assert.equal(generation.counts.contact_details, candidateCount);
  assert.equal(responses.length, 0);
});

test("official client rejects selector and telemetry mismatches before trust", async () => {
  let calls = 0;
  const malformedResponses = [
    operationReceipt({ providerRetryCount: 1 }),
    operationReceipt({ candidates: [{ providerRecordId: "must-not-surface" }] }),
  ];
  const client = createCoreOperatorClient({
    coreApiBaseUrl: "https://core.example.test",
    bearer: "synthetic.operator.token",
    fetch: async () => {
      calls += 1;
      return jsonResponse(malformedResponses.shift());
    },
  });
  await assert.rejects(() => client.startResendCandidateEvidence({
    workspace: "evidence-proof", environment: "production", operationId, connectionId,
    selector: { ...selector, candidateCount: 2 },
    candidates: [{
      providerRecordId: "synthetic-provider-record",
      identityFingerprintSha256: "d".repeat(64),
    }],
    schemaVersion: "resend_candidate_evidence_v1",
    normalizationVersion: "resend_candidate_normalization_v1",
    identityFingerprintVersion: "tenant_hmac_sha256_v1",
    identityCustody: { emailAddressKeyId: "synthetic-key-v1", emailNormalizationVersion: 1 },
  }), (error) => error instanceof CoreOperatorError
    && error.reason === "provider_evidence_candidate_request_invalid"
    && error.coreEffect === "none");
  assert.equal(calls, 0);

  await assert.rejects(() => client.readResendCandidateEvidence({
    workspace: "evidence-proof", environment: "production",
    operationId, connectionId, selector,
  }), (error) => error instanceof CoreOperatorError
    && error.reason === "core_operator_receipt_invalid"
    && error.coreEffect === "none");
  assert.equal(calls, 1);

  await assert.rejects(() => client.readResendCandidateEvidence({
    workspace: "evidence-proof", environment: "production",
    operationId, connectionId, selector,
  }), (error) => error instanceof CoreOperatorError
    && error.reason === "core_operator_receipt_invalid"
    && error.coreEffect === "none");
  assert.equal(calls, 2);
});

function operationReceipt(overrides = {}) {
  return {
    authority: { provider: "resend", providerAccess: "candidate_scoped_get_only",
      providerMutation: "not_granted", contactMutation: "not_granted" },
    operationId, workspaceId: "workspace-evidence", environment: "production",
    connectionId, credentialVersion: 3, selector,
    status: "acquiring", nextStage: "topic_definitions", nextTargetOrdinal: null,
    nextCursorPresent: false, nextCursorChecksumSha256: null,
    nextRequestNumber: 1, providerCallCount: 0,
    providerRetryCount: 0, providerThrottleCount: 0, rateLimit: null,
    requestCount: 0, failedAttemptCount: 0, contactDetailCount: 0,
    contactTopicPreferenceCount: 0, topicDefinitionCount: 0,
    propertyDefinitionCount: 0, observationStartAt: "2026-08-27T10:00:00.000Z",
    observationEndAt: null, coverage: null, ...overrides,
  };
}

function generationReceipt() {
  return {
    authority: { provider: "resend", providerAccess: "candidate_scoped_get_only",
      providerMutation: "not_granted", contactMutation: "not_granted" },
    generationId, sourceOperationId: operationId, workspaceId: "workspace-evidence",
    environment: "production", connectionId, credentialVersion: 3, selector,
    counts: { requests: candidateCount * 2 + 2, failedAttempts: 0,
      providerCalls: candidateCount * 2 + 2, providerRetries: 0,
      providerThrottles: 0, contactDetails: candidateCount,
      contactTopicPreferences: 123, topicDefinitions: 4, propertyDefinitions: 6 },
    coverage: { contactDetailsSha256: "1".repeat(64),
      contactTopicsSha256: "2".repeat(64), definitionsSha256: "3".repeat(64),
      completeCoverageSha256: "4".repeat(64) },
    observationInterval: { start: "2026-08-27T10:00:00.000Z",
      end: "2026-08-27T14:00:00.000Z" },
    sealChecksumSha256: "5".repeat(64), sealedAt: "2026-08-27T14:00:01.000Z",
  };
}

function guard() {
  return { selectorGenerationId, artifactSha256: selector.artifactSha256,
    candidateManifestSha256: selector.candidateManifestSha256 };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
