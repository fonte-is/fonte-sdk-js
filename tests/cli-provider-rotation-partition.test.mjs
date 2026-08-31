import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { createCoreOperatorClient } from "../packages/cli/dist/operator-client.js";
import { providerRotationReceipt } from "../packages/cli/dist/operator-provider-rotation-json.js";
import { runProgram } from "../packages/cli/dist/program.js";

const iterationId = "10000000-0000-4000-8000-000000000231";
const connectionId = "20000000-0000-4000-8000-000000000231";
const candidateOperationId = "30000000-0000-4000-8000-000000000231";
const outgoingCandidateOperationId = "31000000-0000-4000-8000-000000000231";
const populationGenerationId = "40000000-0000-4000-8000-000000000231";
const placementSegmentId = "41000000-0000-4000-8000-000000000231";
const candidateGenerationId = "50000000-0000-4000-8000-000000000231";
const partitionGenerationId = "60000000-0000-4000-8000-000000000231";
const newestQualifyingBroadcastId = "70000000-0000-4000-8000-000000000231";
const oldestBroadcastId = "80000000-0000-4000-8000-000000000231";
const coreUrl = "https://core.example.test";
const bearer = "synthetic.operator.bearer";

test("four fixed commands parse exact iteration and recovery guards", () => {
  assert.equal(
    providerRotationReceipt(populationReceipt()).iterationId,
    iterationId,
  );
  const commands = [startArgs(), advanceArgs(1), readArgs(), sealArgs()].map(
    (argv) => parseArguments(argv).operator,
  );
  assert.deepEqual(
    commands.map((command) => command.kind),
    [
      "bridge_provider_rotation_start",
      "bridge_provider_rotation_advance",
      "bridge_provider_rotation_read",
      "bridge_provider_rotation_seal",
    ],
  );
  assert.deepEqual(commands[0], {
    kind: "bridge_provider_rotation_start",
    workspace: "northstar",
    environment: "production",
    iterationId,
    connectionId,
    candidateOperationId,
    outgoingCandidateOperationId,
    populationSelectorGenerationId: populationGenerationId,
    placementSegmentId,
    qualifyingBroadcastId: newestQualifyingBroadcastId,
    orderedBroadcastIds: [newestQualifyingBroadcastId, oldestBroadcastId],
    coldRemaining: 1,
    identityCustody: {
      emailAddressKeyId: "tenant-email-custody-v1",
      emailNormalizationVersion: 1,
    },
  });
  assert.equal(commands[1].expectedPageNumber, 1);
  assert.deepEqual(commands[3].orderedBroadcastIds, [
    newestQualifyingBroadcastId,
    oldestBroadcastId,
  ]);
  assert.throws(() => parseArguments(advanceArgs(0)));
  assert.throws(() =>
    parseArguments([...sealArgs(), "--recipient", "hidden@example.test"]),
  );
});

test("rotation help requires newest-to-oldest broadcast order", async () => {
  for (const operation of ["start", "seal"]) {
    const result = await runProgram(
      ["bridge", "rotation", operation, "--help"],
      {},
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /newest-to-oldest/);
  }
});

test("rotation client accepts an exact aggregate receipt", async () => {
  const client = createCoreOperatorClient({
    coreApiBaseUrl: coreUrl,
    bearer,
    fetch: async () => json(populationReceipt()),
  });
  await client.startProviderRotation(parseArguments(startArgs()).operator);
});

test("official runner forwards exact Core operations and emits aggregate receipts", async () => {
  const cases = [
    [startArgs(), populationReceipt(), "rotation-start", "POST"],
    [
      advanceArgs(1),
      populationReceipt({ nextPageNumber: 2 }),
      "rotation-advance",
      "POST",
    ],
    [
      readArgs(),
      populationReceipt(),
      `rotation-progress/${iterationId}`,
      "GET",
    ],
    [sealArgs(), terminalReceipt(), "rotation-seal", "POST"],
  ];
  for (const [argv, response, path, method] of cases) {
    const requests = [];
    const result = await runProgram(argv, dependencies(requests, response));
    assert.equal(
      result.exitCode,
      0,
      JSON.stringify({ receipt: result.receipt, requests }),
    );
    assert.equal(
      result.receipt.authority.contract_id,
      "fonte.core.provider_rotation_partition.v1",
    );
    const request = requests[0];
    assert.equal(request.method, method);
    assert.match(request.url, new RegExp(`${path.replaceAll("/", "\\/")}`));
    if (method === "GET") {
      assert.equal(request.body, null);
      assert.equal(request.idempotencyKey, null);
      assert.equal(result.receipt.core_effect, "none");
    } else {
      assert.equal(result.receipt.core_effect, "attempted");
    }
    if (path === "rotation-start") {
      assert.equal(
        request.body.qualifyingBroadcastId,
        newestQualifyingBroadcastId,
      );
      assert.equal(request.body.placementSegmentId, placementSegmentId);
      assert.deepEqual(request.body.orderedBroadcastIds, [
        newestQualifyingBroadcastId,
        oldestBroadcastId,
      ]);
      assert.equal("recipient" in request.body, false);
      assert.equal("credential" in request.body, false);
    }
    assertAggregateOnly(result.stdout);

    const human = await runProgram(
      argv.filter((value) => value !== "--json"),
      dependencies([], response),
    );
    assert.equal(human.exitCode, 0);
    assert.match(human.stdout, /Fonte Bridge rotation:/);
    assert.match(human.stdout, /Partition E\/W\/X\/U:/);
    assert.match(human.stdout, /Contact mutation not_granted/);
    assert.doesNotMatch(human.stdout, /operator_receipt_unrenderable/);
    assertAggregateOnly(human.stdout);
  }
});

test("unknown and malformed evidence fail closed; advance loss is not retried", async () => {
  const blocked = await runProgram(
    sealArgs(),
    dependencies([], terminalReceipt({ blocked: true })),
  );
  assert.equal(blocked.exitCode, 3);
  assert.equal(blocked.receipt.outcome, "blocked");
  assert.equal(blocked.receipt.result.partition.counts.U, 1);
  assert.equal(blocked.receipt.result.partition.outgoing, null);
  assertAggregateOnly(blocked.stdout);

  for (const argv of [startArgs(), advanceArgs(1), readArgs(), sealArgs()]) {
    const human = await runProgram(
      argv.filter((value) => value !== "--json"),
      dependencies([], terminalReceipt({ blocked: true })),
    );
    assert.equal(human.exitCode, 3);
    assert.match(human.stdout, /Fonte Bridge rotation: blocked_unknown/);
    assert.match(human.stdout, /Partition E\/W\/X\/U: 1\/1\/0\/1/);
    assert.doesNotMatch(human.stdout, /operator_receipt_unrenderable/);
    assertAggregateOnly(human.stdout);
  }

  const malformed = await runProgram(
    readArgs(),
    dependencies([], {
      ...populationReceipt(),
      contacts: [{ email: "hidden@example.test" }],
    }),
  );
  assert.equal(malformed.receipt.reason, "core_operator_receipt_invalid");
  assert.equal(malformed.receipt.core_effect, "none");
  assertAggregateOnly(malformed.stdout);

  const unknownReason = await runProgram(
    readArgs(),
    dependencies([], {
      ...terminalReceipt(),
      partition: {
        ...terminalReceipt().partition,
        reasonCounts: [
          { category: "E", reason: "caller_defined_eligible", count: 2 },
          { category: "W", reason: "no_message_history", count: 1 },
        ],
      },
    }),
  );
  assert.equal(unknownReason.receipt.reason, "core_operator_receipt_invalid");
  assert.equal(unknownReason.receipt.core_effect, "none");
  assertAggregateOnly(unknownReason.stdout);

  assert.throws(() =>
    providerRotationReceipt({
      ...terminalReceipt(),
      outgoingIntake: { count: 1 },
    }),
  );
  assert.throws(() =>
    providerRotationReceipt({
      ...terminalReceipt(),
      authority: {
        ...terminalReceipt().authority,
        contactMutation: "granted",
      },
    }),
  );
  assert.throws(() =>
    providerRotationReceipt({
      ...terminalReceipt(),
      partition: {
        ...terminalReceipt().partition,
        freshnessPolicy: {
          ...terminalReceipt().partition.freshnessPolicy,
          evaluatedAt: "2026-08-28T08:09:00.000Z",
        },
      },
    }),
  );
  assert.throws(() =>
    providerRotationReceipt({
      ...terminalReceipt(),
      partition: {
        ...terminalReceipt().partition,
        freshnessPolicy: {
          ...terminalReceipt().partition.freshnessPolicy,
          positiveSignalMaxAgeSeconds: 7_776_001,
        },
      },
    }),
  );

  const readback = `fonte bridge rotation read --workspace northstar --environment production --iteration-id ${iterationId} --json`;
  for (const argv of [startArgs(), advanceArgs(7), sealArgs()]) {
    for (const jsonOutput of [true, false]) {
      let calls = 0;
      const invocation = jsonOutput
        ? argv
        : argv.filter((value) => value !== "--json");
      const lost = await runProgram(
        invocation,
        dependencies([], populationReceipt(), () => {
          calls += 1;
          throw new Error("synthetic response loss");
        }),
      );
      assert.equal(calls, 1);
      assert.equal(lost.receipt.reason, "core_api_unavailable");
      assert.equal(lost.receipt.core_effect, "unknown");
      assert.deepEqual(lost.receipt.next_action, {
        kind: "run_command",
        command: readback,
        retry_mutation: false,
      });
      if (jsonOutput) {
        assert.deepEqual(JSON.parse(lost.stdout).next_action, {
          kind: "run_command",
          command: readback,
          retry_mutation: false,
        });
      } else {
        assert.match(lost.stdout, /Fonte Bridge rotation operation/);
        assert.match(lost.stdout, new RegExp(readback));
        assert.match(lost.stdout, /Retry mutation: false\./);
        assert.match(lost.stdout, /Do not retry the mutation\./);
      }
      assertAggregateOnly(lost.stdout);
    }
  }
});

function startArgs() {
  return [
    ...base("start"),
    "--connection-id",
    connectionId,
    "--candidate-operation-id",
    candidateOperationId,
    "--outgoing-candidate-operation-id",
    outgoingCandidateOperationId,
    "--population-selector-generation-id",
    populationGenerationId,
    "--placement-segment-id",
    placementSegmentId,
    "--qualifying-broadcast-id",
    newestQualifyingBroadcastId,
    "--ordered-broadcast-id",
    newestQualifyingBroadcastId,
    "--ordered-broadcast-id",
    oldestBroadcastId,
    "--cold-remaining",
    "1",
    "--identity-key-id",
    "tenant-email-custody-v1",
    "--identity-normalization-version",
    "1",
    "--json",
  ];
}

function advanceArgs(page) {
  return [...base("advance"), "--expected-page-number", String(page), "--json"];
}

function readArgs() {
  return [...base("read"), "--json"];
}

function sealArgs() {
  return [
    ...base("seal"),
    "--candidate-generation-id",
    candidateGenerationId,
    "--partition-generation-id",
    partitionGenerationId,
    "--qualifying-broadcast-id",
    newestQualifyingBroadcastId,
    "--ordered-broadcast-id",
    newestQualifyingBroadcastId,
    "--ordered-broadcast-id",
    oldestBroadcastId,
    "--json",
  ];
}

function base(operation) {
  return [
    "bridge",
    "rotation",
    operation,
    "--workspace",
    "northstar",
    "--environment",
    "production",
    "--iteration-id",
    iterationId,
  ];
}

function populationReceipt(overrides = {}) {
  return {
    schemaVersion: "provider_rotation_partition.v1",
    orderingVersion: "provider_rotation_engagement_created_email.v1",
    authority: {
      provider: "resend",
      providerAccess: "get_only_stored_credential",
      providerMutation: "not_granted",
      contactMutation: "not_granted",
      unknownAllowsEffect: false,
    },
    iterationId,
    workspaceId: "workspace-northstar",
    environment: "production",
    connectionId,
    placementSegmentId,
    credentialVersion: 9,
    status: "acquiring_population",
    populationProgress: {
      convergencePass: 1,
      nextPageNumber: 1,
      nextCursorPresent: false,
      nextCursorChecksumSha256: null,
      pages: 0,
      providerCalls: 0,
      providerRetries: 0,
      providerThrottles: 0,
      ...overrides,
    },
    population: null,
    broadcastProgress: {
      qualifyingBroadcastId: newestQualifyingBroadcastId,
      orderedBroadcastIds: [newestQualifyingBroadcastId, oldestBroadcastId],
      nextBroadcastOrdinal: 1,
      nextStage: "metadata",
      nextCursorPresent: false,
      nextCursorChecksumSha256: null,
      pages: 0,
      providerCalls: 0,
      providerRetries: 0,
      providerThrottles: 0,
    },
    broadcastEvidence: null,
    candidateAcquisition: null,
    outgoingCandidateAcquisition: null,
    outgoingIntake: null,
    coldRemaining: 1,
    partition: null,
    candidateGenerationId: null,
    partitionGenerationId: null,
  };
}

function terminalReceipt(options = {}) {
  const blocked = options.blocked ?? false;
  const population = {
    selectorGenerationId: populationGenerationId,
    count: 3,
    rootSha256: "a".repeat(64),
    artifactSha256: "b".repeat(64),
    candidateManifestSha256: "c".repeat(64),
    observedAt: {
      start: "2026-08-28T08:00:00.000Z",
      end: "2026-08-28T08:10:00.000Z",
    },
  };
  return {
    ...populationReceipt(),
    status: blocked ? "blocked_unknown" : "complete",
    populationProgress: {
      convergencePass: 2,
      nextPageNumber: 3,
      nextCursorPresent: false,
      nextCursorChecksumSha256: null,
      pages: 2,
      providerCalls: 2,
      providerRetries: 0,
      providerThrottles: 0,
    },
    population,
    broadcastProgress: {
      qualifyingBroadcastId: newestQualifyingBroadcastId,
      orderedBroadcastIds: [newestQualifyingBroadcastId, oldestBroadcastId],
      nextBroadcastOrdinal: null,
      nextStage: null,
      nextCursorPresent: false,
      nextCursorChecksumSha256: null,
      pages: 10,
      providerCalls: 10,
      providerRetries: 0,
      providerThrottles: 0,
    },
    broadcastEvidence: {
      broadcasts: [newestQualifyingBroadcastId, oldestBroadcastId].map(
        (broadcastId, index) => ({
          broadcastId,
          sentAt: `2026-08-2${8 - index}T08:00:00.000Z`,
          outcomes: {
            accepted: { count: 3, identitySetSha256: "1".repeat(64) },
            delivered: { count: 2, identitySetSha256: "2".repeat(64) },
            opened: { count: 1, identitySetSha256: "3".repeat(64) },
            clicked: { count: 0, identitySetSha256: "4".repeat(64) },
          },
        }),
      ),
      evidenceChecksumSha256: "5".repeat(64),
    },
    candidateAcquisition: {
      operationId: candidateOperationId,
      selectorId: `${iterationId}:population`,
      ...selector(
        population.count,
        population.selectorGenerationId,
        population.artifactSha256,
        population.rootSha256,
        population.candidateManifestSha256,
      ),
    },
    outgoingCandidateAcquisition: blocked
      ? null
      : {
          operationId: outgoingCandidateOperationId,
          selectorId: `${iterationId}:D`,
          ...selector(
            1,
            partitionGenerationId,
            "d".repeat(64),
            "e".repeat(64),
            "f".repeat(64),
          ),
        },
    outgoingIntake: null,
    partition: partition(blocked),
    candidateGenerationId,
    partitionGenerationId,
  };
}

function partition(blocked) {
  const counts = blocked
    ? { E: 1, W: 1, X: 0, U: 1 }
    : { E: 2, W: 1, X: 0, U: 0 };
  const artifacts = ["1", "2", "3", "4"];
  const identities = ["5", "6", "7", "8"];
  const manifests = ["9", "a", "b", "c"];
  const selectors = Object.fromEntries(
    ["E", "W", "X", "U"].map((category, index) => [
      category,
      {
        selectorId: `${iterationId}:${category}`,
        ...selector(
          counts[category],
          partitionGenerationId,
          artifacts[index].repeat(64),
          identities[index].repeat(64),
          manifests[index].repeat(64),
        ),
      },
    ]),
  );
  return {
    schemaVersion: "provider_rotation_partition.v1",
    orderingVersion: "provider_rotation_engagement_created_email.v1",
    status: blocked ? "blocked_unknown" : "complete",
    populationCount: 3,
    populationRootSha256: "a".repeat(64),
    counts,
    reasonCounts: blocked
      ? [
          { category: "E", reason: "retirement_evidence_complete", count: 1 },
          { category: "W", reason: "no_message_history", count: 1 },
          { category: "U", reason: "freshness_unbound", count: 1 },
        ]
      : [
          { category: "E", reason: "retirement_evidence_complete", count: 2 },
          { category: "W", reason: "no_positive_signal", count: 1 },
        ],
    selectors,
    outgoing: blocked
      ? null
      : {
          selectorId: `${iterationId}:D`,
          ...selector(
            1,
            partitionGenerationId,
            "d".repeat(64),
            "e".repeat(64),
            "f".repeat(64),
          ),
        },
    outgoingCount: blocked ? 0 : 1,
    coldRemaining: 1,
    freshnessPolicy: {
      evaluatedAt: "2026-08-28T08:30:00.000Z",
      populationMaxAgeSeconds: 86_400,
      suppressionMaxAgeSeconds: 86_400,
      broadcastObservationMaxAgeSeconds: 86_400,
      positiveSignalMaxAgeSeconds: 7_776_000,
      candidateGenerationMaxAgeSeconds: 86_400,
    },
    unionConservationSha256: "a".repeat(64),
    partitionChecksumSha256: "f".repeat(64),
  };
}

function selector(count, generation, artifact, identities, manifest) {
  return {
    selectorGenerationId: generation,
    artifactSha256: artifact,
    identitySetSha256: identities,
    candidateCount: count,
    candidateManifestSha256: manifest,
  };
}

function dependencies(requests, response, coreFetch) {
  return {
    cwd: "/synthetic",
    randomUUID: () => iterationId,
    runner: { run: async () => 1 },
    operator: {
      authorize: async () => bearer,
      sleep: async () => {},
      fetch: async (input, init = {}) => {
        if (String(input).includes(".well-known/fonte-cli.json")) {
          return json({
            schema: "fonte.cli.hosted_config.v1",
            authorizationServer: "https://auth.example.test",
            clientId: "fonte-cli-client-v0",
            coreApiBaseUrl: coreUrl,
            redirectUri: "http://127.0.0.1:49671/callback",
            scopes: ["email"],
          });
        }
        if (coreFetch) return coreFetch(input, init);
        requests.push({
          url: String(input),
          method: init.method,
          body: init.body ? JSON.parse(init.body) : null,
          idempotencyKey: init.headers["idempotency-key"] ?? null,
        });
        return json(response);
      },
    },
  };
}

function assertAggregateOnly(output) {
  for (const forbidden of [
    bearer,
    "hidden@example.test",
    "providerRecordId",
    "identityFingerprintSha256",
    "recipients",
    "contacts",
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
