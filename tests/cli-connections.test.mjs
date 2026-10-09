import assert from "node:assert/strict";
import test from "node:test";
import { createConnectionClient } from "../packages/cli/dist/connection-client.js";
import {
  createCoreRequester,
  CoreOperatorError,
} from "../packages/cli/dist/operator-core-request.js";
import { runProgram } from "../packages/cli/dist/program.js";
import { handleCoreMcpRequest } from "../packages/cli/dist/mcp-core-handler.js";

const scope = { workspace: "northstar", environment: "sandbox" };
const connectionRef = `fc_${"a".repeat(64)}`;
const choiceRef = `fcc_${"b".repeat(64)}`;
const sourceRef = "fs_10000000-0000-4000-8000-000000000001";
const operationRef = "fi_10000000-0000-4000-8000-000000000002";
const attemptId = "10000000-0000-4000-8000-000000000003";
const time = "2026-10-09T10:00:00.000Z";
const connected = {
  connectionRef,
  choiceRef,
  accountLabel: "Primary account",
  status: "ready",
  capabilities: ["contacts.read", "contacts.import"],
  credentialVersion: 2,
  verifiedAt: time,
  updatedAt: time,
};
const waiting = {
  attemptRef: `fca_${attemptId}`,
  connectionRef: null,
  status: "waiting",
  reason: "authorization_pending",
  nextAction: {
    type: "open_url",
    url: "https://accounts.example.test/authorize?state=opaque",
  },
  expiresAt: time,
  pollAfterMilliseconds: 1000,
  connection: null,
};
const source = { sourceRef, connectionRef, label: "Subscribers" };
const counts = {
  total: 2,
  processed: 2,
  submitted: 2,
  valid: 2,
  invalid: 0,
  duplicate: 0,
  linked: 2,
  matchedContacts: 1,
  createdContacts: 1,
  updatedContacts: null,
  unchangedContacts: null,
  conflicts: null,
  evidenceWritten: 2,
  quarantined: 0,
  created: 1,
  matched: 1,
  blocked: 0,
  failed: 0,
  unknown: 0,
};
const imported = {
  operationRef,
  sourceRef,
  status: "completed",
  created: true,
  submittedAt: time,
  completedAt: time,
  contactImportBatchId: "10000000-0000-4000-8000-000000000004",
  counts,
};
const authorization = {
  ...scope,
  choiceRef,
  attemptId,
  displayName: "Primary account",
  connectionRef: null,
  expectedCredentialVersion: null,
};
const choices = {
  choices: [
    {
      choiceRef,
      label: "Connected contacts",
      capabilities: ["contacts.read", "contacts.import"],
      status: "available",
    },
  ],
};

function harness(reply) {
  const calls = [];
  const client = createConnectionClient(
    createCoreRequester({
      coreApiBaseUrl: "https://api.example.test",
      bearer: "synthetic-bearer",
      maxResponseBytes: 65_536,
      fetch: async (url, init) => {
        calls.push({ url: String(url), ...init });
        const result = await reply(calls.at(-1));
        return Response.json(result);
      },
    }),
  );
  return { client, calls };
}

test("connection choices and reads use the selected scope and exact returned references", async () => {
  const h = harness((call) =>
    call.url.includes("/choices?")
      ? choices
      : call.url.includes(`${connectionRef}?`)
        ? connected
        : { connections: [connected] },
  );
  assert.deepEqual(await h.client.listConnectionChoices(scope), choices);
  assert.deepEqual(await h.client.listConnections(scope), {
    connections: [connected],
  });
  assert.deepEqual(
    await h.client.readConnection({ ...scope, connectionRef }),
    connected,
  );
  assert.deepEqual(
    h.calls.map((call) => new URL(call.url).pathname),
    [
      "/v1/workspaces/northstar/connections/choices",
      "/v1/workspaces/northstar/connections",
      `/v1/workspaces/northstar/connections/${connectionRef}`,
    ],
  );
  assert.ok(
    h.calls.every(
      (call) => new URL(call.url).searchParams.get("environment") === "sandbox",
    ),
  );
  assert.ok(
    h.calls.every(
      (call) => call.headers.authorization === "Bearer synthetic-bearer",
    ),
  );
  await h.client.listConnections({ ...scope, workspace: "NX7A9Q" });
  assert.equal(
    new URL(h.calls.at(-1).url).pathname,
    "/v1/workspaces/NX7A9Q/connections",
  );
});

test("lost authorization response stays uncertain and recovery uses the same attempt", async () => {
  let lose = true;
  const h = harness(() => {
    if (lose) {
      lose = false;
      throw Error("response lost");
    }
    return waiting;
  });
  await assert.rejects(
    h.client.beginConnectionAuthorization(authorization),
    (error) =>
      error instanceof CoreOperatorError && error.coreEffect === "unknown",
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    await h.client.readConnectionAuthorization({
      ...scope,
      attemptRef: `fca_${attemptId}`,
    }),
    waiting,
  );
  assert.equal(h.calls[0].headers["idempotency-key"], attemptId);
  assert.deepEqual(JSON.parse(h.calls[0].body), {
    choiceRef,
    attemptId,
    displayName: "Primary account",
    connectionRef: null,
    expectedCredentialVersion: null,
  });
  assert.equal(h.calls[1].method, "GET");
  assert.match(
    h.calls[1].url,
    new RegExp(`/authorizations/fca_${attemptId}\\?`),
  );
});

test("reconnect keeps account reference and credential version; disconnect readback is explicit", async () => {
  const h = harness((call) =>
    call.url.includes("/disconnect?")
      ? { ...connected, status: "disconnected", credentialVersion: 3 }
      : {
          ...waiting,
          status: "ready",
          reason: "connection_ready",
          connectionRef,
          connection: connected,
          nextAction: null,
        },
  );
  const result = await h.client.beginConnectionAuthorization({
    ...authorization,
    connectionRef,
    expectedCredentialVersion: 2,
  });
  assert.equal(result.connection.connectionRef, connectionRef);
  assert.equal(JSON.parse(h.calls[0].body).expectedCredentialVersion, 2);
  assert.equal(
    (
      await h.client.disconnectConnection({
        ...scope,
        connectionRef,
        expectedCredentialVersion: 2,
      })
    ).status,
    "disconnected",
  );
  assert.deepEqual(JSON.parse(h.calls[1].body), {
    expectedCredentialVersion: 2,
  });
});

test("source discovery, preview and import retain source and operation identity", async () => {
  const h = harness((call) =>
    call.url.includes("/contact-sources?")
      ? { observedAt: time, coverage: "complete", sources: [source] }
      : call.url.includes("/preview?")
        ? {
            source,
            ready: false,
            observedAt: null,
            observationFingerprint: null,
            counts: null,
            unavailableReasons: ["source_unavailable"],
          }
        : imported,
  );
  assert.deepEqual(
    (await h.client.listContactSources({ ...scope, connectionRef })).sources,
    [source],
  );
  const preview = await h.client.previewContactSource({ ...scope, sourceRef });
  assert.equal(preview.ready, false);
  assert.equal(preview.counts, null);
  assert.deepEqual(
    (
      await h.client.importContacts({
        ...scope,
        sourceRef,
        idempotencyKey: "import-original",
      })
    ).counts,
    counts,
  );
  assert.deepEqual(JSON.parse(h.calls[2].body), {
    sourceRef,
    idempotencyKey: "import-original",
  });
  assert.equal(h.calls[2].headers["idempotency-key"], "import-original");
  assert.equal(
    (await h.client.readContactImport({ ...scope, operationRef })).operationRef,
    operationRef,
  );
  assert.equal(h.calls[3].method, "GET");
});

test("malformed scope, unmatched receipts and unexpected credential fields fail closed", async () => {
  const h = harness(() => ({ ...connected, credential: "untrusted-secret" }));
  for (const input of [
    { ...scope, environment: "other" },
    { ...scope, extra: true },
    { ...scope, workspace: "../outside" },
    { ...scope, workspace: "north--star" },
  ])
    await assert.rejects(h.client.listConnections(input));
  for (const input of [
    { ...authorization, expectedCredentialVersion: 1 },
    { ...authorization, attemptId: "another-attempt" },
  ])
    await assert.rejects(h.client.beginConnectionAuthorization(input));
  assert.equal(h.calls.length, 0);
  await assert.rejects(
    h.client.readConnection({ ...scope, connectionRef }),
    (error) =>
      error.reason === "core_operator_receipt_invalid" &&
      !error.message.includes("untrusted-secret"),
  );
  const other = harness(() => ({
    ...connected,
    connectionRef: `fc_${"d".repeat(64)}`,
  }));
  await assert.rejects(
    other.client.readConnection({ ...scope, connectionRef }),
    { reason: "core_operator_receipt_invalid" },
  );
  const mismatch = harness(() => ({
    observedAt: time,
    coverage: "complete",
    sources: [{ ...source, connectionRef: `fc_${"d".repeat(64)}` }],
  }));
  await assert.rejects(
    mismatch.client.listContactSources({ ...scope, connectionRef }),
    { reason: "core_operator_receipt_invalid" },
  );
});

test("CLI invalid input has no authorization effect and import preserves its request key", async () => {
  let authCalls = 0;
  const apiCalls = [];
  const deps = {
    cwd: process.cwd(),
    randomUUID: () => {
      throw Error("unexpected identity allocation");
    },
    runner: {
      run: async () => {
        throw Error("unexpected command");
      },
    },
    operator: {
      authorize: async () => {
        authCalls++;
        return "synthetic-bearer";
      },
      fetch: async (url, init) => {
        if (String(url).endsWith("fonte-cli.json"))
          return Response.json({
            schema: "fonte.cli.hosted_config.v1",
            authorizationServer: "https://accounts.example.test",
            clientId: "synthetic-client",
            coreApiBaseUrl: "https://api.example.test",
            redirectUri: "http://127.0.0.1:49671/callback",
            scopes: ["email"],
          });
        apiCalls.push({ url: String(url), init });
        return Response.json(imported);
      },
      sleep: async () => {},
    },
  };
  const args = [
    "contacts",
    "import",
    "--workspace",
    "northstar",
    "--environment",
    "sandbox",
    "--source-ref",
    sourceRef,
    "--idempotency-key",
    "import-original",
    "--json",
  ];
  assert.equal(
    (await runProgram([...args, "--unexpected", "value"], deps)).exitCode,
    2,
  );
  assert.equal(authCalls, 0);
  const result = await runProgram(args, deps);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).receipt, imported);
  assert.equal(authCalls, 1);
  assert.deepEqual(JSON.parse(apiCalls[0].init.body), {
    sourceRef,
    idempotencyKey: "import-original",
  });
});

test("hosted MCP uses the same scoped connection client and reports denied versus ambiguous effects", async () => {
  async function call(name, args, request) {
    const response = await handleCoreMcpRequest(
      new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
      request,
      "https://api.example.test",
    );
    return (await response.json()).result;
  }
  let calls = 0;
  const selected = { ...scope, connection_ref: connectionRef };
  const result = await call(
    "fonte_list_contact_sources",
    selected,
    async (path) => {
      calls++;
      assert.equal(
        path,
        `/v1/workspaces/northstar/connections/${connectionRef}/contact-sources?environment=sandbox`,
      );
      return { observedAt: time, coverage: "complete", sources: [source] };
    },
  );
  assert.deepEqual(result.structuredContent.receipt.sources, [source]);
  assert.equal(calls, 1);
  const batch = "10000000-0000-4000-8000-000000000004";
  const batchResult = {
    kind: "contact_import_status",
    environment: "sandbox",
    status: "completed",
    contact_import_batch_id: batch,
    identity_set_sha256: "f".repeat(64),
  };
  const readBatch = await call(
    "fonte_read_contact_import_batch",
    { ...scope, contact_import_batch_id: batch },
    async (path, options) => {
      assert.equal(path, "/v1/broadcast-email/contact-imports");
      assert.deepEqual(options.body, {
        workspaceSlug: scope.workspace,
        environment: scope.environment,
        contactImportBatchId: batch,
      });
      assert.equal(options.lostResponseEffect, "none");
      return {
        tenantId: "10000000-0000-4000-8000-000000000005",
        environment: "sandbox",
        status: "completed",
        contactImportBatchId: batch,
        identitySetSha256: batchResult.identity_set_sha256,
      };
    },
  );
  assert.deepEqual(readBatch.structuredContent.receipt, batchResult);
  for (const [status, effect, outcome] of [
    [403, "none", "denied"],
    [409, "none", "conflict"],
    [null, "unknown", "ambiguous"],
  ]) {
    let attempts = 0;
    const failed = await call(
      "fonte_import_contacts",
      { ...scope, source_ref: sourceRef, idempotency_key: "import-original" },
      async () => {
        attempts++;
        throw new CoreOperatorError(
          "contact_source_unavailable",
          status,
          effect,
        );
      },
    );
    assert.equal(attempts, 1);
    assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.outcome, outcome);
    assert.equal(failed.structuredContent.core_effect, effect);
  }
});

test("audience reconciliation and freeze keep distinct effects and retain the observed fingerprint", async () => {
  const fingerprint = "e".repeat(64);
  const batch = "10000000-0000-4000-8000-000000000004";
  const audienceCounts = {
    source: 3,
    exclusionUnion: 1,
    protected: 1,
    unknown: 0,
    final: 1,
  };
  const input = {
    ...scope,
    source: { kind: "connected_source", sourceRef },
    exclusionSourceRefs: [],
  };
  const h = harness((call) =>
    call.url.includes("/reconcile?")
      ? {
          ready: true,
          observationFingerprint: fingerprint,
          counts: audienceCounts,
          exclusions: [],
          unavailableInputs: [],
          contacts: [
            {
              email: "person@example.invalid",
              disposition: "final",
              protectionReasons: [],
              exclusionSourceRefs: [],
            },
          ],
        }
      : {
          frozenAudienceId: batch,
          contactImportBatchId: batch,
          label: "Selected audience",
          created: true,
          observationFingerprint: fingerprint,
          counts: audienceCounts,
          recipientExpression: {
            include: [{ kind: "import_batch", contactImportBatchId: batch }],
            exclude: [],
          },
        },
  );
  const reconciled = await h.client.reconcileAudience(input);
  assert.deepEqual(reconciled.counts, audienceCounts);
  assert.equal("contacts" in reconciled, false);
  assert.deepEqual(JSON.parse(h.calls[0].body), {
    source: input.source,
    exclusionSourceRefs: [],
  });
  const frozen = await h.client.freezeAudience({
    ...input,
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: "freeze-original",
  });
  assert.equal(frozen.contactImportBatchId, batch);
  assert.match(h.calls[0].url, /\/connected-audience\/reconcile\?/);
  assert.match(h.calls[1].url, /\/connected-audience\/freeze\?/);
  assert.equal(h.calls[1].headers["idempotency-key"], "freeze-original");
  assert.equal(
    JSON.parse(h.calls[1].body).expectedObservationFingerprint,
    fingerprint,
  );
});
