import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "http://127.0.0.1:43112",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const fingerprint = "a".repeat(64);
const sourceChecksum = "b".repeat(64);
const importBatchId = "10000000-0000-4000-8000-000000000301";
const bearer = "header.payload.signature";

test("Resend Bridge grammar binds exact observation and explicit copy", () => {
  assert.deepEqual(
    parseArguments([
      "bridge",
      "observe",
      "resend",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--segment-id",
      "segment-one",
      "--json",
    ]),
    {
      command: "operator",
      apply: false,
      json: true,
      operator: {
        kind: "bridge_resend_preview",
        workspace: "northstar",
        environment: "sandbox",
        segmentId: "segment-one",
      },
    },
  );
  assert.deepEqual(
    parseArguments([
      "bridge",
      "copy",
      "resend",
      "--workspace",
      "northstar",
      "--environment",
      "production",
      "--segment-id",
      "segment-one",
      "--fingerprint",
      fingerprint,
      "--idempotency-key",
      "copy-once-7",
    ]).operator,
    {
      kind: "bridge_resend_copy",
      workspace: "northstar",
      environment: "production",
      segmentId: "segment-one",
      observationFingerprint: fingerprint,
      idempotencyKey: "copy-once-7",
    },
  );
  assert.throws(() =>
    parseArguments([
      "bridge",
      "copy",
      "resend",
      "--workspace",
      "northstar",
      "--environment",
      "sandbox",
      "--segment-id",
      "segment-one",
      "--fingerprint",
      `sha256:${fingerprint}`,
      "--idempotency-key",
      "copy-once-7",
    ]),
  );
});

test("preview is one read-only Core observation with sanitized JSON", async () => {
  const requests = [];
  const result = await runProgram(
    previewArguments("--json"),
    dependencies(async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input) === configUrl) return json(config);
      return json(
        previewReceipt({
          contacts: [{ email: "hidden@example.test" }],
          providerPayload: "provider-secret-payload",
        }),
      );
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  const request = requests[1];
  assert.equal(
    request.url,
    "http://127.0.0.1:43112/v1/workspaces/northstar/bridge/resend/segments/segment-one/preview?environment=sandbox",
  );
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {});
  assert.equal("idempotency-key" in request.init.headers, false);
  assert.equal(request.init.headers.authorization, `Bearer ${bearer}`);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.authority.contract_id, "fonte.core.resend_bridge.v1");
  assert.equal(receipt.result.observation_fingerprint, fingerprint);
  assert.equal(receipt.result.contacts_observed, 3);
  assert.equal(receipt.result.protected.contacts, 2);
  assert.equal(receipt.core_effect, "none");
  assertSanitized(result.stdout);
});

test("copy sends only the exact fingerprint and idempotency binding", async () => {
  const requests = [];
  const result = await runProgram(
    copyArguments("--json"),
    dependencies(async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input) === configUrl) return json(config);
      return json(
        {
          ...previewReceipt({
            contacts: [{ email: "hidden@example.test" }],
          }),
          importReceipt: {
            contactImportBatchId: importBatchId,
            sourceChecksumSha256: sourceChecksum,
            idempotencyKey: `resend-bridge:copy-once-7:${fingerprint.slice(0, 32)}`,
            created: true,
          },
          reconciliation: {
            accepted: 3,
            created: 2,
            updated: 1,
            unchanged: 0,
            protected: 2,
            conflict: 0,
            unknown: 3,
          },
        },
        201,
      );
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  const request = requests[1];
  assert.equal(
    request.url,
    "http://127.0.0.1:43112/v1/workspaces/northstar/bridge/resend/segments/segment-one/copy?environment=sandbox",
  );
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["idempotency-key"], "copy-once-7");
  assert.deepEqual(JSON.parse(request.init.body), {
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: "copy-once-7",
  });
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, "completed");
  assert.equal(receipt.core_effect, "copied");
  assert.deepEqual(receipt.result.import_receipt, {
    contact_import_batch_id: importBatchId,
    created: true,
  });
  assert.equal(receipt.result.reconciliation.accepted, 3);
  assertSanitized(result.stdout);
  assert.equal(result.stdout.includes("copy-once-7"), false);
  assert.equal(result.stdout.includes(sourceChecksum), false);
});

test("credential-custody 503 is a plain no-effect blocker", async () => {
  const result = await runProgram(
    previewArguments(),
    dependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      return json({ error: "resend_bridge_unavailable" }, 503);
    }),
  );

  assert.equal(result.exitCode, 3);
  assert.equal(result.receipt.reason, "resend_bridge_unavailable");
  assert.equal(result.receipt.core_effect, "none");
  assert.match(result.stdout, /Core returned 503/);
  assert.match(result.stdout, /credential custody is unavailable/);
});

test("a lost copy response never claims a completed copy", async () => {
  const result = await runProgram(
    copyArguments("--json"),
    dependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      throw new Error("response lost");
    }),
  );

  const receipt = JSON.parse(result.stdout);
  assert.equal(result.exitCode, 3);
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(receipt.result, null);
});

function previewArguments(extra) {
  return [
    "bridge",
    "observe",
    "resend",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--segment-id",
    "segment-one",
    ...(extra ? [extra] : []),
  ];
}

function copyArguments(extra) {
  return [
    "bridge",
    "copy",
    "resend",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--segment-id",
    "segment-one",
    "--fingerprint",
    fingerprint,
    "--idempotency-key",
    "copy-once-7",
    ...(extra ? [extra] : []),
  ];
}

function previewReceipt(extra = {}) {
  return {
    provider: "resend",
    connectionId: "resend-primary",
    segment: { id: "segment-one", name: "Operators" },
    observedAt: "2026-08-20T10:00:00.000Z",
    observationFingerprint: fingerprint,
    pagination: {
      status: "complete",
      contacts: { status: "complete", pagesObserved: 2, hasMore: false },
      suppressions: { status: "complete", pagesObserved: 1, hasMore: false },
    },
    contactsObserved: 3,
    protectedObservations: {
      contacts: 2,
      providerUnsubscribed: 1,
      providerSuppressed: 2,
    },
    unknowns: {
      contacts: 3,
      propertyObservations: 4,
      suppressionObservations: 0,
      automationDependency: "unknown",
    },
    ...extra,
  };
}

function assertSanitized(output) {
  for (const forbidden of [
    bearer,
    "hidden@example.test",
    "provider-secret-payload",
    '"providerPayload"',
    '"sourceChecksumSha256"',
    '"idempotencyKey"',
  ]) {
    assert.equal(output.includes(forbidden), false);
  }
}

function dependencies(fetcher) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000399",
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      fetch: fetcher,
      authorize: async () => bearer,
      sleep: async () => undefined,
    },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
