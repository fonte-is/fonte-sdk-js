import assert from "node:assert/strict";

export const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
export const coreUrl = "http://127.0.0.1:43112";
export const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: coreUrl,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
export const bearer = "header.payload.signature";
export const sourceConnection = "10000000-0000-4000-8000-000000000501";
export const exclusionConnection = "10000000-0000-4000-8000-000000000502";
export const batchId = "10000000-0000-4000-8000-000000000503";
export const fingerprint = "a".repeat(64);
export const identitySetSha256 = "b".repeat(64);

export function contactImportStatusArguments(extra) {
  return [
    "bridge",
    "import",
    "status",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--contact-import-batch-id",
    batchId,
    ...(extra ? [extra] : []),
  ];
}

export function contactImportStatusReceipt(overrides = {}) {
  return {
    tenantId: "10000000-0000-4000-8000-000000000504",
    environment: "sandbox",
    contactImportBatchId: batchId,
    identitySetSha256,
    status: "completed",
    rowReadback: [
      {
        contactId: "10000000-0000-4000-8000-000000000599",
        sourcePayload: { email: "hidden@example.test" },
      },
    ],
    ...overrides,
  };
}

export function collectionArguments(provider, extra) {
  return [
    "bridge",
    "collections",
    provider,
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--connection-id",
    sourceConnection,
    ...(extra ? [extra] : []),
  ];
}

export function reconcileArguments() {
  return [
    "bridge",
    "reconcile",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--source-provider",
    "resend",
    "--source-connection-id",
    sourceConnection,
    "--source-collection-id",
    "segment-one",
    "--source-display-name",
    "Customers",
    "--max-age-seconds",
    "300",
    "--exclude-provider",
    "kit",
    "--exclude-connection-id",
    exclusionConnection,
    "--exclude-collection-id",
    "42",
    "--exclude-display-name",
    "Suppressed",
  ];
}

export function freezeArguments() {
  return [
    ...reconcileArguments().with(1, "freeze"),
    "--fingerprint",
    fingerprint,
    "--idempotency-key",
    "freeze-once-5",
  ];
}

export function frozenAudienceArguments(
  operation = "reconcile",
  exclusions = 24,
) {
  return [
    "bridge",
    operation,
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--source-import-batch-id",
    batchId,
    "--source-identity-set-sha256",
    identitySetSha256,
    ...(exclusions > 0 ? ["--max-age-seconds", "300"] : []),
    ...Array.from({ length: exclusions }, (_, index) => [
      "--exclude-provider",
      "resend",
      "--exclude-connection-id",
      exclusionConnection,
      "--exclude-collection-id",
      `protected-${String(index + 1).padStart(2, "0")}`,
      "--exclude-display-name",
      `Protected ${index + 1}`,
    ]).flat(),
    ...(operation === "freeze"
      ? ["--fingerprint", fingerprint, "--idempotency-key", "freeze-once-5"]
      : []),
  ];
}

export function sourceReference() {
  return reference(
    "resend",
    sourceConnection,
    "segment",
    "segment-one",
    "Customers",
  );
}

export function exclusionReference() {
  return reference("kit", exclusionConnection, "tag", "42", "Suppressed");
}

export function frozenAudienceReference() {
  return {
    kind: "fonte_audience",
    contactImportBatchId: batchId,
    identitySetSha256,
  };
}

export function protectedReference(index) {
  return reference(
    "resend",
    exclusionConnection,
    "segment",
    `protected-${String(index + 1).padStart(2, "0")}`,
    `Protected ${index + 1}`,
  );
}

export function frozenAudienceReconciliationReceipt(exclusions = 24) {
  return {
    workspaceId: "10000000-0000-4000-8000-000000000504",
    environment: "sandbox",
    ready: true,
    observationFingerprint: fingerprint,
    source: {
      reference: frozenAudienceReference(),
      observedAt: "2026-08-21T09:55:00.000Z",
      contactsObserved: 30,
      coverage: { status: "complete", pagesObserved: 1 },
    },
    exclusions: Array.from({ length: exclusions }, (_, index) => ({
      ...summary(protectedReference(index), 0, index),
      overlapCount: 0,
    })),
    unavailableInputs: [],
    counts: {
      source: 30,
      exclusionUnion: 0,
      protected: 1,
      unknown: 1,
      final: 28,
    },
    contacts: [],
  };
}

export function reconciliationReceipt() {
  return {
    workspaceId: "10000000-0000-4000-8000-000000000504",
    environment: "sandbox",
    ready: true,
    observationFingerprint: fingerprint,
    source: summary(sourceReference(), 5),
    exclusions: [summary(exclusionReference(), 2, 0)],
    unavailableInputs: [],
    counts: {
      source: 5,
      exclusionUnion: 1,
      protected: 1,
      unknown: 1,
      final: 2,
    },
    contacts: [
      {
        source: {
          normalizedEmail: "hidden@example.test",
          providerContactId: "provider-contact-secret",
        },
      },
    ],
  };
}

export function freezeReceipt() {
  return {
    frozenAudienceId: batchId,
    contactImportBatchId: batchId,
    label: "Resend · Customers",
    created: true,
    observationFingerprint: fingerprint,
    counts: reconciliationReceipt().counts,
    recipientExpression: {
      include: [{ kind: "import_batch", contactImportBatchId: batchId }],
      exclude: [],
    },
  };
}

export function dependencies(requests, coreResponse) {
  return baseDependencies(async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return String(input) === configUrl ? json(config) : coreResponse();
  });
}

export function baseDependencies(fetcher) {
  return {
    cwd: process.cwd(),
    randomUUID: () => batchId,
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      fetch: fetcher,
      authorize: async () => bearer,
      sleep: async () => undefined,
    },
  };
}

export function assertSanitized(output) {
  for (const value of [
    bearer,
    "provider-secret",
    "hidden@example.test",
    "provider-contact-secret",
    '"contacts"',
    "freeze-once-5",
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

function reference(
  provider,
  connectionId,
  collectionType,
  collectionId,
  displayName,
) {
  return {
    provider,
    connectionId,
    collectionType,
    collectionId,
    displayName,
    observationRequirements: { completeness: "complete", maxAgeSeconds: 300 },
  };
}

function summary(reference, contactsObserved, index) {
  return {
    reference,
    observedAt: "2026-08-21T10:00:00.000Z",
    providerDisplayName: reference.displayName,
    contactsObserved,
    coverage: { status: "complete", pagesObserved: 2 },
    ...(index === undefined ? {} : { index, overlapCount: 1 }),
  };
}
