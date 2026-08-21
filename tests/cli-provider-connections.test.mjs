import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { runProgram } from "../packages/cli/dist/program.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const coreUrl = "http://127.0.0.1:43112";
const bearer = "header.payload.signature";
const attemptId = "10000000-0000-4000-8000-000000000701";
const connectionId = "10000000-0000-4000-8000-000000000702";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: coreUrl,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("connection grammar is symmetric and has no credential input", async () => {
  assert.deepEqual(parseArguments(listArguments("kit")).operator, {
    kind: "bridge_connection_list",
    workspace: "northstar",
    environment: "production",
    provider: "kit",
  });
  assert.deepEqual(parseArguments(connectArguments("resend")).operator, {
    kind: "bridge_connection_connect",
    workspace: "northstar",
    environment: "production",
    provider: "resend",
    displayName: "Primary connection",
  });
  assert.deepEqual(
    parseArguments([
      "bridge",
      "connections",
      "reconnect",
      "kit",
      "--workspace",
      "northstar",
      "--environment",
      "production",
      "--connection-id",
      connectionId,
      "--display-name",
      "Kit connection",
      "--expected-credential-version",
      "2",
    ]).operator,
    {
      kind: "bridge_connection_reconnect",
      workspace: "northstar",
      environment: "production",
      provider: "kit",
      connectionId,
      displayName: "Kit connection",
      expectedCredentialVersion: 2,
    },
  );
  for (const flag of ["--credential", "--api-key", "--token", "--file"]) {
    assert.throws(() =>
      parseArguments([...connectArguments("resend"), flag, "secret"]),
    );
  }
  for (const operation of ["connect", "reconnect"]) {
    const resendHelp = await runProgram(
      ["bridge", "connections", operation, "resend", "--help"],
      dependencies({ fetch: async () => assert.fail("help must not request") }),
    );
    assert.equal(resendHelp.exitCode, 0);
    assert.match(resendHelp.stdout, /native Resend OAuth/);

    const kitHelp = await runProgram(
      ["bridge", "connections", operation, "kit", "--help"],
      dependencies({ fetch: async () => assert.fail("help must not request") }),
    );
    assert.equal(kitHelp.exitCode, 0);
    assert.match(kitHelp.stdout, /Kit OAuth is currently unavailable/);
    assert.match(kitHelp.stdout, /fails closed/);
    assert.doesNotMatch(kitHelp.stdout, /Starts native|Reauthorizes/);
  }
});

test("Kit list returns only sanitized matching connection metadata", async () => {
  const result = await runProgram(
    [...listArguments("kit"), "--json"],
    dependencies({
      fetch: async (input) =>
        String(input) === configUrl
          ? json(config)
          : json({
              connections: [
                connectionReceipt("kit", connectionId),
                connectionReceipt(
                  "resend",
                  "10000000-0000-4000-8000-000000000703",
                ),
              ],
              credential: "synthetic-provider-token",
            }),
    }),
  );
  assert.equal(result.exitCode, 0);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.result.provider, "kit");
  assert.deepEqual(receipt.result.connections, [
    {
      provider: "kit",
      connection_id: connectionId,
      display_name: "Primary connection",
      credential_version: 1,
      status: "ready",
    },
  ]);
  assertSanitized(result.stdout);
});

test("Resend connect opens full_access consent and polls sanitized Core status", async () => {
  const requests = [];
  const opened = [];
  let coreReads = 0;
  const result = await runProgram(
    [...connectArguments("resend"), "--json"],
    dependencies({
      fetch: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        if (String(input) === configUrl) return json(config);
        if (init.method === "POST") return json(oauthReceipt("waiting"), 201);
        coreReads += 1;
        return json(oauthReceipt(coreReads === 1 ? "waiting" : "ready"));
      },
      openUrl: async (url) => {
        opened.push(url.toString());
        return true;
      },
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/api\.resend\.com\/oauth\/authorize\?/);
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[1].init.headers["idempotency-key"], attemptId);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    attemptId,
    connectionId,
    displayName: "Primary connection",
    operation: "connect",
    expectedCredentialVersion: null,
  });
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.result.status, "ready");
  assert.equal(receipt.result.requested_scope, "full_access");
  assert.equal(receipt.result.connection_id, connectionId);
  assert.equal(receipt.result.connection.connection_id, connectionId);
  assert.equal(receipt.core_effect, "created");
  assertSanitized(result.stdout);
});

test("authorization URL is returned when a browser cannot be opened", async () => {
  const result = await runProgram(
    connectArguments("resend"),
    dependencies({
      fetch: async (input) =>
        String(input) === configUrl
          ? json(config)
          : json(oauthReceipt("waiting"), 201),
      openUrl: async () => false,
    }),
  );
  assert.equal(result.exitCode, 3);
  assert.match(
    result.stdout,
    /Authorize in your browser: https:\/\/api\.resend\.com/,
  );
  assert.match(result.stdout, /Provider scope: full_access/);
  assert.match(result.stdout, new RegExp(connectionId));
  assertSanitized(result.stdout);
});

test("Kit connect is typed but fails closed at unavailable provider OAuth", async () => {
  const result = await runProgram(
    [...connectArguments("kit"), "--json"],
    dependencies({
      fetch: async (input) =>
        String(input) === configUrl
          ? json(config)
          : json({ error: "provider_oauth_unavailable" }, 503),
    }),
  );
  assert.equal(result.exitCode, 3);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, "provider_oauth_unavailable");
  assert.equal(receipt.result, null);
  assert.equal(receipt.core_effect, "none");
  assertSanitized(result.stdout);
});

test("ambiguous OAuth initiation keeps stable recovery identities", async () => {
  for (const response of ambiguousResponses()) {
    const result = await runProgram(
      [...connectArguments("resend"), "--json"],
      dependencies({
        fetch: async (input) =>
          String(input) === configUrl ? json(config) : response(),
      }),
    );
    assertUnknownRecovery(result);
  }
});

test("ambiguous OAuth polling keeps stable recovery identities", async () => {
  for (const response of ambiguousResponses()) {
    const result = await runProgram(
      [...connectArguments("resend"), "--json"],
      dependencies({
        fetch: async (input, init = {}) => {
          if (String(input) === configUrl) return json(config);
          return init.method === "POST"
            ? json(oauthReceipt("waiting"), 201)
            : response();
        },
        openUrl: async () => true,
      }),
    );
    assertUnknownRecovery(result);
  }
});

function ambiguousResponses() {
  return [
    async () => {
      throw new Error("response lost");
    },
    async () => json({ error: "internal_error" }, 500),
    async () => json({ attemptId }),
  ];
}

function assertUnknownRecovery(result) {
  assert.equal(result.exitCode, 3);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.result.status, "unknown");
  assert.equal(receipt.result.attempt_id, attemptId);
  assert.equal(receipt.result.connection_id, connectionId);
  assert.equal(receipt.result.authorization_url, null);
  assert.equal(receipt.core_effect, "unknown");
  assertSanitized(result.stdout);
}

function listArguments(provider) {
  return [
    "bridge",
    "connections",
    "list",
    provider,
    "--workspace",
    "northstar",
    "--environment",
    "production",
  ];
}

function connectArguments(provider) {
  return [
    "bridge",
    "connections",
    "connect",
    provider,
    "--workspace",
    "northstar",
    "--environment",
    "production",
    "--display-name",
    "Primary connection",
  ];
}

function dependencies({ fetch, openUrl }) {
  const ids = [attemptId, connectionId];
  return {
    cwd: process.cwd(),
    randomUUID: () => ids.shift() ?? assert.fail("unexpected identity request"),
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      fetch,
      authorize: async () => bearer,
      sleep: async () => undefined,
      ...(openUrl ? { openUrl } : {}),
    },
  };
}

function oauthReceipt(status) {
  return {
    attemptId,
    connectionId,
    provider: "resend",
    operation: "connect",
    requestedScope: "full_access",
    status,
    reason: status === "ready" ? "connection_ready" : "authorization_pending",
    authorizationUrl:
      status === "waiting"
        ? `https://api.resend.com/oauth/authorize?state=${attemptId}`
        : null,
    expiresAt: "2026-08-21T12:10:00.000Z",
    pollAfterMilliseconds: 1_000,
    connection:
      status === "ready"
        ? {
            ...connectionReceipt("resend", connectionId),
            accessToken: "synthetic-provider-token",
          }
        : null,
  };
}

function connectionReceipt(provider, id) {
  return {
    workspaceId: "internal-workspace-id",
    environment: "production",
    provider,
    connectionId: id,
    displayName: "Primary connection",
    status: "ready",
    credentialVersion: 1,
    verifiedAt: "2026-08-21T12:00:00.000Z",
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z",
  };
}

function assertSanitized(output) {
  for (const forbidden of [
    bearer,
    "synthetic-provider-token",
    "internal-workspace-id",
    "accessToken",
    "refreshToken",
  ])
    assert.equal(output.includes(forbidden), false);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
