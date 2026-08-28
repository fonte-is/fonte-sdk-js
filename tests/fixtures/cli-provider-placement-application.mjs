import assert from "node:assert/strict";

export const coreUrl = "http://127.0.0.1:43112";
export const applicationFile = "/operator-input/provider-placement.json";
export const applicationId = "10000000-0000-4000-8000-000000000603";
export const refillApplicationId = "10000000-0000-4000-8000-000000000614";
export const outgoingBatchId = "10000000-0000-4000-8000-000000000604";
export const incomingBatchId = "10000000-0000-4000-8000-000000000605";
const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const workspaceId = "10000000-0000-4000-8000-000000000601";
const connectionId = "10000000-0000-4000-8000-000000000602";

export function args(operation) {
  return [
    "bridge",
    "placement",
    operation,
    "--workspace",
    "northstar",
    "--environment",
    "production",
    "--application-file",
    applicationFile,
    "--json",
  ];
}

export function application() {
  const binding = {
    currentObservationFingerprintSha256: "1".repeat(64),
    planFingerprintSha256: "2".repeat(64),
    outgoing: {
      contactImportBatchId: outgoingBatchId,
      sourceChecksumSha256: "3".repeat(64),
      identitySetSha256: "4".repeat(64),
      count: 2,
    },
    incoming: {
      contactImportBatchId: incomingBatchId,
      sourceChecksumSha256: "5".repeat(64),
      identitySetSha256: "6".repeat(64),
      count: 2,
    },
    operatingTargets: {
      providerContactCount: 10,
      minimumFonteContactCount: 10,
    },
    idempotencyKey: applicationId,
  };
  return {
    placement: {
      source: {
        provider: "resend",
        connectionId,
        collectionType: "segment",
        collectionId: "synthetic-segment",
        displayName: "Synthetic source",
        observationRequirements: {
          completeness: "complete",
          maxAgeSeconds: 300,
        },
      },
      exclusions: [],
    },
    ...binding,
    retirementCertificate: {
      schemaVersion: "provider_retirement_certificate.v1",
      certificateId: "10000000-0000-4000-8000-000000000606",
      issuedAt: "2026-08-27T10:00:00.000Z",
      expiresAt: "2026-08-27T10:05:00.000Z",
      scope: {
        workspaceId,
        environment: "production",
        provider: "resend",
        connectionId,
      },
      providerEvidence: providerEvidence(),
      frozenArtifacts: {
        restoreBasicProfileSha256: "f".repeat(64),
        segmentEvidenceSha256: "0".repeat(64),
        orderedColdPoolSha256: "1".repeat(64),
        orderedColdPoolCount: 2,
      },
      driftFences: {
        revalidatedAt: "2026-08-27T10:00:00.000Z",
        revalidationExpiresAt: "2026-08-27T10:10:00.000Z",
        providerPopulationCount: 10,
        fontePopulationCount: 10,
        outgoingPresentCount: 2,
        eligibleForRetirementCount: 2,
        protectedCount: 0,
        unknownCount: 0,
        planCohortFingerprintSha256: "2".repeat(64),
      },
      governance: {
        retirementReadinessReceiptId: "10000000-0000-4000-8000-000000000610",
        standingRotationAuthorityReceiptId:
          "10000000-0000-4000-8000-000000000611",
        correctedSequencingReceiptId: "10000000-0000-4000-8000-000000000612",
      },
      knownLossDisposition: lossDisposition(),
      application: binding,
      certificateChecksumSha256: "5".repeat(64),
    },
  };
}

export function refillApplication() {
  const retirement = application();
  return {
    workspaceId,
    placement: retirement.placement,
    currentObservationFingerprintSha256: "7".repeat(64),
    planFingerprintSha256: "8".repeat(64),
    outgoing: {
      ...retirement.outgoing,
      count: 0,
    },
    incoming: retirement.incoming,
    operatingTargets: retirement.operatingTargets,
    idempotencyKey: refillApplicationId,
  };
}

export function refillCoreApplication() {
  const { workspaceId: _workspaceId, ...input } = refillApplication();
  return input;
}

function providerEvidence() {
  return {
    generationId: "10000000-0000-4000-8000-000000000607",
    sourceOperationId: "10000000-0000-4000-8000-000000000608",
    credentialVersion: 3,
    sealChecksumSha256: "7".repeat(64),
    maxAgeSeconds: 300,
    selector: {
      selectorId: "synthetic-retirement",
      selectorGenerationId: "10000000-0000-4000-8000-000000000609",
      artifactSha256: "8".repeat(64),
      identitySetSha256: "9".repeat(64),
      candidateCount: 2,
      candidateManifestSha256: "a".repeat(64),
    },
    counts: {
      requests: 1,
      failedAttempts: 0,
      providerCalls: 1,
      providerRetries: 0,
      providerThrottles: 0,
      contactDetails: 2,
      contactTopicPreferences: 2,
      topicDefinitions: 1,
      propertyDefinitions: 1,
    },
    coverage: {
      contactDetailsSha256: "b".repeat(64),
      contactTopicsSha256: "c".repeat(64),
      definitionsSha256: "d".repeat(64),
      completeCoverageSha256: "e".repeat(64),
    },
    observationInterval: {
      start: "2026-08-27T09:59:00.000Z",
      end: "2026-08-27T10:00:00.000Z",
    },
    sealedAt: "2026-08-27T10:00:00.000Z",
  };
}

function lossDisposition() {
  return {
    schemaVersion: "provider_loss_disposition_manifest.v1",
    authorityReceiptId: "10000000-0000-4000-8000-000000000613",
    allowedDimensions: ["original_provider_contact_id"],
    dispositions: [
      {
        dimension: "original_provider_contact_id",
        providerInternalMetadataName: null,
        material: false,
        impact: {
          identity: "none",
          consent: "none",
          sendability: "none",
          customerAttributes: "none",
          activeObligations: "none",
        },
        impactEvidence: {
          evidenceId: "synthetic:evidence",
          checksumSha256: "3".repeat(64),
        },
        preservedEvidence: null,
      },
    ],
    manifestChecksumSha256: "4".repeat(64),
  };
}

export function receipt(status) {
  const input = application();
  const complete = status === "complete";
  return {
    schemaVersion: "provider_placement_application.v1",
    workspaceId,
    environment: "production",
    provider: "resend",
    connectionId,
    idempotencyKey: applicationId,
    retirementCertificate: input.retirementCertificate,
    status,
    reasonCode: complete ? null : "application_remaining",
    plan: {
      currentObservationFingerprintSha256:
        input.currentObservationFingerprintSha256,
      planFingerprintSha256: input.planFingerprintSha256,
    },
    outgoing: {
      ...input.outgoing,
      confirmed: complete ? 2 : 1,
      remaining: complete ? 0 : 1,
    },
    incoming: {
      ...input.incoming,
      confirmed: complete ? 2 : 0,
      remaining: complete ? 0 : 2,
    },
    operatingTargets: input.operatingTargets,
    readback: {
      providerPopulationCount: complete ? 10 : 8,
      providerTargetHeadroom: complete ? 0 : 2,
      fontePopulationCount: 10,
      providerObservationFingerprintSha256: "6".repeat(64),
      providerObservedAt: "2026-08-27T10:01:00.000Z",
      fonteObservedAt: "2026-08-27T10:01:00.000Z",
    },
  };
}

export function refillReceipt(status) {
  const input = refillApplication();
  const complete = status === "complete";
  return {
    schemaVersion: "provider_placement_application.v1",
    workspaceId,
    environment: "production",
    provider: "resend",
    connectionId,
    idempotencyKey: refillApplicationId,
    retirementCertificate: null,
    status,
    reasonCode: complete ? null : "application_remaining",
    plan: {
      currentObservationFingerprintSha256:
        input.currentObservationFingerprintSha256,
      planFingerprintSha256: input.planFingerprintSha256,
    },
    outgoing: {
      ...input.outgoing,
      confirmed: 0,
      remaining: 0,
    },
    incoming: {
      ...input.incoming,
      confirmed: complete ? input.incoming.count : 0,
      remaining: complete ? 0 : input.incoming.count,
    },
    operatingTargets: input.operatingTargets,
    readback: {
      providerPopulationCount: complete ? 10 : 8,
      providerTargetHeadroom: complete ? 0 : 2,
      fontePopulationCount: 10,
      providerObservationFingerprintSha256: "9".repeat(64),
      providerObservedAt: "2026-08-27T10:02:00.000Z",
      fonteObservedAt: "2026-08-27T10:02:00.000Z",
    },
  };
}

export function dependencies(
  requests,
  coreResponse,
  fileValue = application(),
  authorizeHook,
) {
  return {
    cwd: process.cwd(),
    randomUUID: () => applicationId,
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      readProviderPlacementApplicationFile: async (path) => {
        assert.equal(path, applicationFile);
        return JSON.stringify(fileValue);
      },
      fetch: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return String(input) === configUrl ? json(config()) : coreResponse();
      },
      authorize: async () => {
        authorizeHook?.();
        return "header.payload.signature";
      },
      sleep: async () => undefined,
    },
  };
}

export function assertAggregateOnly(output) {
  for (const value of [
    "hidden@example.test",
    "provider-contact-secret",
    "normalizedEmail",
    "providerRecordId",
    "candidates",
  ]) {
    assert.equal(output.includes(value), false);
  }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
