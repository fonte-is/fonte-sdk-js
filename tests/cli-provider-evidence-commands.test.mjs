import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { renderOperatorHuman } from "../packages/cli/dist/operator-render.js";
import { runProgram } from "../packages/cli/dist/program.js";
import { hostedConfig } from "./fixtures/cli-production-broadcast-responses.mjs";

const operationId = "10000000-0000-4000-8000-000000000247";
const generationId = "20000000-0000-4000-8000-000000000247";
const connectionId = "30000000-0000-4000-8000-000000000247";
const selectorGenerationId = "40000000-0000-4000-8000-000000000247";
const candidatesFile = "/synthetic/provider-evidence-candidates.json";
const bearer = "synthetic.header.signature";
const selector = {
  selectorId: "sealed-selector-v1",
  selectorGenerationId,
  artifactSha256: "a".repeat(64),
  identitySetSha256: "b".repeat(64),
  candidateCount: 2,
  candidateManifestSha256: "c".repeat(64),
};
const candidates = [
  {
    providerRecordId: "synthetic-provider-target-1",
    identityFingerprintSha256: "d".repeat(64),
  },
  {
    providerRecordId: "synthetic-provider-target-2",
    identityFingerprintSha256: "e".repeat(64),
  },
];

test("five fixed commands parse complete guards without candidate material", () => {
  const parsed = [
    startArguments(),
    operationArguments("read"),
    operationArguments("advance", ["--expected-request-number", "1"]),
    operationArguments("seal", ["--generation-id", generationId]),
    generationReadArguments(),
  ].map((argv) => parseArguments(argv));
  assert.deepEqual(
    parsed.map((item) => item.operator.kind),
    [
      "provider_evidence_candidate_start",
      "provider_evidence_candidate_read",
      "provider_evidence_candidate_advance",
      "provider_evidence_candidate_seal",
      "provider_evidence_candidate_generation_read",
    ],
  );
  assert.deepEqual(parsed[0].operator.selector, selector);
  assert.equal(parsed[0].operator.candidatesFile, candidatesFile);
  assert.equal(
    JSON.stringify(parsed).includes("synthetic-provider-target"),
    false,
  );
  for (const argv of [startArguments(), operationArguments("read")]) {
    assert.throws(() =>
      parseArguments(argv.filter((item) => item !== "--json")),
    );
  }
});

test("candidate material in argv is rejected without reflection", async () => {
  const sensitive = "synthetic-recipient@example.test";
  const result = await runProgram(
    [...startArguments(), "--provider-record-id", sensitive],
    {
      cwd: "/synthetic",
      randomUUID: () => operationId,
      runner: { run: async () => 1 },
    },
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes(sensitive), false);
  assert.equal(result.stdout.includes("provider-record-id"), false);
});

test("installed commands forward exact requests and emit aggregate receipts only", async () => {
  const cases = [
    [startArguments(), operationReceipt(), "POST"],
    [operationArguments("read"), operationReceipt(), "GET"],
    [
      operationArguments("advance", ["--expected-request-number", "1"]),
      operationReceipt(),
      "POST",
    ],
    [
      operationArguments("seal", ["--generation-id", generationId]),
      generationReceipt(),
      "POST",
    ],
    [generationReadArguments(), generationReceipt(), "GET"],
  ];
  const requests = [];
  for (const [argv, response, method] of cases) {
    const result = await runProgram(argv, dependencies({ response, requests }));
    assert.equal(result.exitCode, 0);
    assert.equal(requests.at(-1).method, method);
    const receipt = JSON.parse(result.stdout);
    assert.match(receipt.result.kind, /^provider_evidence_candidate_/);
    assert.equal(
      receipt.authority.contract_id,
      "fonte.core.provider_evidence_candidate.v1",
    );
    for (const forbidden of [
      bearer,
      candidatesFile,
      "synthetic-provider-target",
      "d".repeat(64),
      "e".repeat(64),
      "identityFingerprintSha256",
      "candidates",
    ]) {
      assert.equal(result.stdout.includes(forbidden), false);
      assert.equal(result.stderr.includes(forbidden), false);
    }
  }
  assert.equal(requests.length, 5);
  assert.deepEqual(requests[0].body.selector, selector);
  assert.equal(requests[0].body.operationId, operationId);
  assert.deepEqual(requests[0].body.candidates, candidates);
  assert.deepEqual(requests[2].body, { ...guard(), expectedRequestNumber: 1 });
  assert.equal(requests[2].idempotencyKey, `${operationId}:1`);
  assert.deepEqual(requests[3].body, { generationId, ...guard() });
  assert.equal(requests[1].body, null);
  assert.equal(requests[4].body, null);
  for (const request of [requests[1], requests[4]]) {
    assert.deepEqual(Object.fromEntries(new URL(request.url).searchParams), {
      environment: "production",
      ...guard({ candidateCount: "2" }),
    });
  }
});

test("malformed candidate files fail before OAuth or Core", async () => {
  let authorizationCount = 0;
  let fetchCount = 0;
  const result = await runProgram(
    startArguments(),
    dependencies({
      response: operationReceipt(),
      requests: [],
      candidateFile: JSON.stringify({
        candidates: [
          {
            ...candidates[0],
            email: "must-not-be-accepted@example.test",
          },
          candidates[1],
        ],
      }),
      authorize: async () => {
        authorizationCount += 1;
        return bearer;
      },
      onFetch: () => {
        fetchCount += 1;
      },
    }),
  );
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "provider_evidence_candidate_request_invalid");
  assert.equal(receipt.core_effect, "none");
  assert.equal(result.stdout.includes("must-not-be-accepted"), false);
  assert.equal(authorizationCount, 0);
  assert.equal(fetchCount, 0);
});

test("ambiguous mutations name exact readback and forbid retry", async () => {
  const readScope = [
    "--workspace evidence-proof",
    "--environment production",
    `--connection-id ${connectionId}`,
    `--selector-id ${selector.selectorId}`,
    `--selector-generation-id ${selector.selectorGenerationId}`,
    `--artifact-sha256 ${selector.artifactSha256}`,
    `--identity-set-sha256 ${selector.identitySetSha256}`,
    `--candidate-count ${selector.candidateCount}`,
    `--candidate-manifest-sha256 ${selector.candidateManifestSha256}`,
  ].join(" ");
  const cases = [
    [
      startArguments(),
      `fonte provider-evidence resend read ${readScope} --operation-id ${operationId} --json`,
    ],
    [
      operationArguments("advance", ["--expected-request-number", "7"]),
      `fonte provider-evidence resend read ${readScope} --operation-id ${operationId} --json`,
    ],
    [
      operationArguments("seal", ["--generation-id", generationId]),
      `fonte provider-evidence resend generation read ${readScope} --generation-id ${generationId} --json`,
    ],
  ];
  for (const [argv, readback] of cases) {
    let coreCalls = 0;
    const result = await runProgram(
      argv,
      dependencies({
        response: operationReceipt(),
        requests: [],
        failCore: true,
        onCore: () => {
          coreCalls += 1;
        },
      }),
    );
    const receipt = JSON.parse(result.stdout);
    assert.equal(result.exitCode, 3);
    assert.equal(receipt.reason, "core_api_unavailable");
    assert.equal(receipt.core_effect, "unknown");
    assert.deepEqual(receipt.next_action, {
      kind: "run_command",
      command: readback,
      retry_mutation: false,
    });
    assert.equal(coreCalls, 1);

    const human = renderOperatorHuman(result.receipt);
    assert.match(human, /Fonte provider evidence operation/);
    assert.equal(human.includes("production broadcast operation"), false);
    assert.match(human, new RegExp(readback));
    assert.match(human, /Retry mutation: false\./);
    assert.match(human, /Do not retry the mutation\./);
  }
});

function dependencies(options) {
  return {
    cwd: "/synthetic",
    randomUUID: () => "50000000-0000-4000-8000-000000000247",
    runner: { run: async () => 1 },
    operator: {
      authorize: options.authorize ?? (async () => bearer),
      sleep: async () => {},
      readProviderEvidenceCandidateFile: async () =>
        options.candidateFile ?? JSON.stringify({ candidates }),
      fetch: async (input, init = {}) => {
        options.onFetch?.();
        if (String(input).includes(".well-known/fonte-cli.json")) {
          return json(hostedConfig("https://core.example.test"));
        }
        options.onCore?.();
        if (options.failCore) throw new Error("synthetic response loss");
        const body = init.body ? JSON.parse(init.body) : null;
        options.requests.push({
          url: String(input),
          method: init.method,
          body,
          idempotencyKey: init.headers["idempotency-key"] ?? null,
        });
        return json(options.response);
      },
    },
  };
}

function startArguments() {
  return [
    "provider-evidence",
    "resend",
    "start",
    ...commonArguments(),
    "--operation-id",
    operationId,
    "--candidates-file",
    candidatesFile,
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

function operationArguments(command, extra = []) {
  return [
    "provider-evidence",
    "resend",
    command,
    ...commonArguments(),
    "--operation-id",
    operationId,
    ...extra,
    "--json",
  ];
}

function generationReadArguments() {
  return [
    "provider-evidence",
    "resend",
    "generation",
    "read",
    ...commonArguments(),
    "--generation-id",
    generationId,
    "--json",
  ];
}

function commonArguments() {
  return [
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
    "--candidate-manifest-sha256",
    selector.candidateManifestSha256,
  ];
}

function operationReceipt() {
  return {
    authority: authority(),
    operationId,
    workspaceId: "workspace-evidence",
    environment: "production",
    connectionId,
    credentialVersion: 3,
    selector,
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

function generationReceipt() {
  return {
    authority: authority(),
    generationId,
    sourceOperationId: operationId,
    workspaceId: "workspace-evidence",
    environment: "production",
    connectionId,
    credentialVersion: 3,
    selector,
    counts: {
      requests: 6,
      failedAttempts: 0,
      providerCalls: 6,
      providerRetries: 0,
      providerThrottles: 0,
      contactDetails: 2,
      contactTopicPreferences: 1,
      topicDefinitions: 1,
      propertyDefinitions: 2,
    },
    coverage: {
      contactDetailsSha256: "1".repeat(64),
      contactTopicsSha256: "2".repeat(64),
      definitionsSha256: "3".repeat(64),
      completeCoverageSha256: "4".repeat(64),
    },
    observationInterval: {
      start: "2026-08-27T10:00:00.000Z",
      end: "2026-08-27T11:00:00.000Z",
    },
    sealChecksumSha256: "5".repeat(64),
    sealedAt: "2026-08-27T11:00:01.000Z",
  };
}

function authority() {
  return {
    provider: "resend",
    providerAccess: "candidate_scoped_get_only",
    providerMutation: "not_granted",
    contactMutation: "not_granted",
  };
}

function guard(overrides = {}) {
  return {
    connectionId,
    selectorId: selector.selectorId,
    selectorGenerationId,
    artifactSha256: selector.artifactSha256,
    identitySetSha256: selector.identitySetSha256,
    candidateCount: selector.candidateCount,
    candidateManifestSha256: selector.candidateManifestSha256,
    ...overrides,
  };
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
