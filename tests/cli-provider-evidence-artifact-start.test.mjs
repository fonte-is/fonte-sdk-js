import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { renderOperatorHuman } from "../packages/cli/dist/operator-render.js";
import { runProgram } from "../packages/cli/dist/program.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const coreUrl = "http://127.0.0.1:43112";
const operationId = "10000000-0000-4000-8000-000000000247";
const connectionId = "20000000-0000-4000-8000-000000000247";
const selectorGenerationId = "30000000-0000-4000-8000-000000000247";
const candidatePath = "/synthetic/frozen-candidates.csv";
const identityPath = "/synthetic/frozen-identities.csv";
const candidateArtifact =
  "provider_id,created_at,first_name,last_name,email,unsubscribed\n" +
  "provider-a,2026-08-27T10:00:00.000Z,Synthetic,A,one@example.test,false\n" +
  "provider-b,2026-08-27T10:00:00.000Z,Synthetic,B,two@example.test,false\n";
const identitySetArtifact = "email\none@example.test\ntwo@example.test\n";
const selector = {
  selectorId: "synthetic-frozen-selector",
  selectorGenerationId,
  artifactSha256: digest(candidateArtifact),
  identitySetSha256: digest(identitySetArtifact),
  candidateCount: 2,
};

test("artifact start parses and forwards the exact frozen pair through Core", async () => {
  const parsed = parseArguments(args());
  assert.deepEqual(parsed.operator.selector, selector);
  assert.equal(parsed.operator.candidateArtifactFile, candidatePath);
  assert.equal(parsed.operator.identitySetArtifactFile, identityPath);
  assert.equal("candidateManifestSha256" in parsed.operator.selector, false);

  const requests = [];
  const result = await runProgram(
    args(),
    dependencies(requests, () => json(operationReceipt())),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(
    requests[0].url,
    `${coreUrl}/v1/workspaces/evidence-proof/provider-evidence/resend/candidate-acquisitions?environment=production`,
  );
  assert.deepEqual(requests[0].body.selector, selector);
  assert.equal(requests[0].body.candidateArtifact, candidateArtifact);
  assert.equal(requests[0].body.identitySetArtifact, identitySetArtifact);
  assert.equal(requests[0].idempotencyKey, operationId);
  assert.equal(
    result.receipt.result.selector.candidate_manifest_sha256,
    "c".repeat(64),
  );
  assertAggregateOnly(result.stdout);
});

test("artifact mismatch fails before hosted config, OAuth, or Core I/O", async () => {
  let fetches = 0;
  let authorizations = 0;
  const result = await runProgram(args(), {
    cwd: "/synthetic",
    randomUUID: () => operationId,
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      readProviderEvidenceCandidateFile: async (path) =>
        path === candidatePath
          ? `${candidateArtifact}tampered`
          : identitySetArtifact,
      fetch: async () => {
        fetches += 1;
        return json({});
      },
      authorize: async () => {
        authorizations += 1;
        return "synthetic.header.signature";
      },
      sleep: async () => undefined,
    },
  });
  assert.equal(result.exitCode, 3);
  assert.equal(
    result.receipt.reason,
    "provider_evidence_candidate_request_invalid",
  );
  assert.equal(result.receipt.core_effect, "none");
  assert.equal(fetches, 0);
  assert.equal(authorizations, 0);
  assertAggregateOnly(result.stdout);
});

test("artifact start response loss performs one Core request without retry", async () => {
  const requests = [];
  const result = await runProgram(
    args(),
    dependencies(requests, () => {
      throw new Error("synthetic response loss");
    }),
  );
  assert.equal(result.exitCode, 3);
  assert.equal(result.receipt.reason, "core_api_unavailable");
  assert.equal(result.receipt.core_effect, "unknown");
  assert.deepEqual(result.receipt.next_action, {
    kind: "stop",
    reason: "candidate_manifest_unavailable",
    retry_mutation: false,
  });
  assert.equal(requests.length, 1);
  const human = renderOperatorHuman(result.receipt);
  assert.match(human, /Fonte provider evidence operation/);
  assert.match(human, /candidate manifest hash was not observed/);
  assert.match(human, /Next action: stop \(candidate_manifest_unavailable\)/);
  assert.match(human, /Retry mutation: false\./);
  assert.match(human, /Do not retry the mutation\./);
  assert.equal(human.includes("production broadcast operation"), false);
  assertAggregateOnly(result.stdout);
});

function args() {
  return [
    "provider-evidence",
    "resend",
    "start",
    "--workspace",
    "evidence-proof",
    "--environment",
    "production",
    "--connection-id",
    connectionId,
    "--selector-id",
    selector.selectorId,
    "--selector-generation-id",
    selector.selectorGenerationId,
    "--artifact-sha256",
    selector.artifactSha256,
    "--identity-set-sha256",
    selector.identitySetSha256,
    "--candidate-count",
    String(selector.candidateCount),
    "--operation-id",
    operationId,
    "--candidate-artifact-file",
    candidatePath,
    "--identity-set-artifact-file",
    identityPath,
    "--schema-version",
    "resend_candidate_evidence_v1",
    "--normalization-version",
    "resend_candidate_normalization_v1",
    "--identity-fingerprint-version",
    "tenant_hmac_sha256_v1",
    "--identity-email-key-id",
    "synthetic-key-v1",
    "--identity-email-normalization-version",
    "1",
    "--json",
  ];
}

function dependencies(requests, coreResponse) {
  return {
    cwd: "/synthetic",
    randomUUID: () => operationId,
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      readProviderEvidenceCandidateFile: async (path) => {
        if (path === candidatePath) return candidateArtifact;
        assert.equal(path, identityPath);
        return identitySetArtifact;
      },
      fetch: async (input, init = {}) => {
        if (String(input) === configUrl) return json(config());
        requests.push({
          url: String(input),
          method: init.method,
          body: JSON.parse(init.body),
          idempotencyKey: init.headers["idempotency-key"],
        });
        return coreResponse();
      },
      authorize: async () => "synthetic.header.signature",
      sleep: async () => undefined,
    },
  };
}

function operationReceipt() {
  return {
    authority: {
      provider: "resend",
      providerAccess: "candidate_scoped_get_only",
      providerMutation: "not_granted",
      contactMutation: "not_granted",
    },
    operationId,
    workspaceId: "40000000-0000-4000-8000-000000000247",
    environment: "production",
    connectionId,
    credentialVersion: 3,
    selector: { ...selector, candidateManifestSha256: "c".repeat(64) },
    status: "acquiring",
    nextStage: "topic_definitions",
    nextTargetOrdinal: null,
    nextCursorPresent: false,
    nextCursorChecksumSha256: null,
    nextRequestNumber: 1,
    providerCallCount: 0,
    providerRetryCount: 0,
    providerThrottleCount: 0,
    rateLimit: null,
    requestCount: 0,
    failedAttemptCount: 0,
    contactDetailCount: 0,
    contactTopicPreferenceCount: 0,
    topicDefinitionCount: 0,
    propertyDefinitionCount: 0,
    observationStartAt: "2026-08-27T10:00:00.000Z",
    observationEndAt: null,
    coverage: null,
  };
}

function config() {
  return {
    schema: "fonte.cli.hosted_config.v1",
    authorizationServer: "https://auth.example.test",
    clientId: "fonte-cli-client-v0",
    coreApiBaseUrl: coreUrl,
    redirectUri: "http://127.0.0.1:49671/callback",
    scopes: ["email"],
  };
}

function assertAggregateOnly(output) {
  for (const value of [
    "one@example.test",
    "two@example.test",
    "provider-a",
    "provider-b",
    candidatePath,
    identityPath,
    "candidateArtifact",
    "identitySetArtifact",
  ]) {
    assert.equal(output.includes(value), false);
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
