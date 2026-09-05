import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import {
  CoreOperatorError,
  createCoreOperatorClient,
} from "../packages/cli/dist/operator-client.js";
import { runProgram } from "../packages/cli/dist/program.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const coreApiBaseUrl = "http://127.0.0.1:43112";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://auth.example.test",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const bearer = "header.payload.signature";
const settings = {
  workspaceId: "10000000-0000-4000-8000-000000000223",
  environment: "production",
  postalAddress: "Fonte, Inc.\n1 Aggregate Way\nSan Francisco, CA 94107",
  postalAddressStatus: "configured",
  version: 1,
  updatedAt: "2026-08-28T09:15:00.000Z",
};

test("marketing settings grammar binds exact scope and rejects malformed input before I/O", async () => {
  assert.deepEqual(parseArguments(argumentsFor()), {
    command: "operator",
    apply: false,
    json: true,
    operator: {
      kind: "workspace_marketing_settings_read",
      workspace: "fonte",
      environment: "production",
    },
  });

  let calls = 0;
  const result = await runProgram(
    [...argumentsFor(), "--postal-address", "must-not-be-accepted"],
    dependencies(
      async () => {
        calls += 1;
        throw new Error("must not request");
      },
      async () => {
        calls += 1;
        throw new Error("must not authorize");
      },
    ),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(
    result.receipt.schema_version,
    "fonte.cli.invalid_invocation.v1",
  );
  assert.equal(calls, 0);

  const client = createCoreOperatorClient({
    coreApiBaseUrl,
    bearer,
    fetch: async () => {
      calls += 1;
      throw new Error("must not request");
    },
  });
  await assert.rejects(
    client.readWorkspaceMarketingSettings({
      workspace: "wrong/slug",
      environment: "production",
    }),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "workspace_marketing_settings_request_invalid" &&
      error.coreEffect === "none",
  );
  assert.equal(calls, 0);
});

test("marketing settings uses one authenticated Core GET and emits aggregate fields only", async () => {
  const requests = [];
  const result = await runProgram(
    argumentsFor(),
    dependencies(async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return String(input) === configUrl ? json(config) : json(settings);
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      configUrl,
      `${coreApiBaseUrl}/v1/workspaces/fonte/marketing-settings?environment=production`,
    ],
  );
  const request = requests[1];
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.body, undefined);
  assert.deepEqual(request.init.headers, {
    accept: "application/json",
    authorization: `Bearer ${bearer}`,
  });

  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, "completed");
  assert.equal(receipt.reason, "workspace_marketing_settings_read");
  assert.equal(receipt.core_effect, "none");
  assert.equal(
    receipt.authority.contract_id,
    "fonte.core.workspace_marketing_settings.v1",
  );
  assert.deepEqual(receipt.result, {
    kind: "workspace_marketing_settings",
    workspaceId: settings.workspaceId,
    environment: settings.environment,
    postalAddress: settings.postalAddress,
    updatedAt: settings.updatedAt,
  });
  assert.deepEqual(Object.keys(receipt.result).sort(), [
    "environment",
    "kind",
    "postalAddress",
    "updatedAt",
    "workspaceId",
  ]);
  assert.equal(result.stdout.includes(bearer), false);
  assert.equal(result.stdout.includes("recipient"), false);
  assert.equal(result.stdout.includes("provider"), false);
});

test("marketing settings represents the exact unset state without inventing configuration", async () => {
  const unset = {
    workspaceId: settings.workspaceId,
    environment: settings.environment,
    postalAddress: null,
    postalAddressStatus: "not_configured",
    version: 0,
    updatedAt: null,
  };
  let coreRequests = 0;
  const result = await runProgram(
    argumentsFor(),
    dependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      coreRequests += 1;
      return json(unset);
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(coreRequests, 1);
  assert.equal(result.receipt.core_effect, "none");
  assert.deepEqual(result.receipt.result, {
    kind: "workspace_marketing_settings",
    workspaceId: unset.workspaceId,
    environment: unset.environment,
    postalAddress: null,
    updatedAt: null,
  });

  const human = await runProgram(
    argumentsFor().filter((value) => value !== "--json"),
    dependencies(async (input) =>
      String(input) === configUrl ? json(config) : json(unset),
    ),
  );
  assert.equal(human.exitCode, 0);
  assert.equal(
    human.stdout,
    [
      "Fonte workspace marketing settings: not configured.",
      `Workspace: ${settings.workspaceId}.`,
      "Environment: production.",
      "Postal address: not configured.",
      "Updated: not configured.",
      "Core effect: none.",
      "",
    ].join("\n"),
  );
});

test("marketing settings accepts a cleared authoritative setting without exposing control fields", async () => {
  const cleared = {
    workspaceId: settings.workspaceId,
    environment: settings.environment,
    postalAddress: null,
    postalAddressStatus: "not_configured",
    version: 2,
    updatedAt: "2026-08-28T10:15:00.000Z",
  };
  const result = await runProgram(
    argumentsFor().filter((value) => value !== "--json"),
    dependencies(async (input) =>
      String(input) === configUrl ? json(config) : json(cleared),
    ),
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.receipt.result, {
    kind: "workspace_marketing_settings",
    workspaceId: cleared.workspaceId,
    environment: cleared.environment,
    postalAddress: null,
    updatedAt: cleared.updatedAt,
  });
  assert.equal(
    result.stdout,
    [
      "Fonte workspace marketing settings: not configured.",
      `Workspace: ${settings.workspaceId}.`,
      "Environment: production.",
      "Postal address: not configured.",
      `Updated: ${cleared.updatedAt}.`,
      "Core effect: none.",
      "",
    ].join("\n"),
  );
  assert.equal(result.stdout.includes("not_configured"), false);
  assert.equal(result.stdout.includes("version"), false);
});

test("marketing settings rejects malformed, extra, blank, and scope-mismatched receipts", async () => {
  const invalidReceipts = [
    {
      workspaceId: settings.workspaceId,
      environment: settings.environment,
      postalAddress: settings.postalAddress,
      updatedAt: settings.updatedAt,
    },
    { ...settings, recipient: "hidden@example.test" },
    { ...settings, updatedAt: undefined },
    { ...settings, workspaceId: " " },
    { ...settings, environment: "sandbox" },
    { ...settings, postalAddress: "\t" },
    { ...settings, updatedAt: "2026-08-28 09:15:00Z" },
    { ...settings, postalAddress: null },
    { ...settings, updatedAt: null },
    { ...settings, postalAddressStatus: "not_configured" },
    { ...settings, version: 0 },
    { ...settings, version: -1 },
    { ...settings, version: 1.5 },
    { ...settings, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...settings, version: "1" },
    {
      ...settings,
      postalAddress: null,
      postalAddressStatus: "not_configured",
      version: 0,
    },
    {
      ...settings,
      postalAddress: null,
      postalAddressStatus: "not_configured",
      updatedAt: null,
    },
  ];
  for (const body of invalidReceipts) {
    let coreRequests = 0;
    const result = await runProgram(
      argumentsFor(),
      dependencies(async (input) => {
        if (String(input) === configUrl) return json(config);
        coreRequests += 1;
        return json(body);
      }),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.reason, "core_operator_receipt_invalid");
    assert.equal(result.receipt.core_effect, "none");
    assert.equal(result.receipt.result, null);
    assert.equal(coreRequests, 1);
  }
});

test("lost marketing settings response has no effect and is never retried", async () => {
  let coreRequests = 0;
  const result = await runProgram(
    argumentsFor(),
    dependencies(async (input) => {
      if (String(input) === configUrl) return json(config);
      coreRequests += 1;
      throw new Error("response lost");
    }),
  );

  assert.equal(result.exitCode, 3);
  assert.equal(result.receipt.reason, "core_api_unavailable");
  assert.equal(result.receipt.core_effect, "none");
  assert.equal(result.receipt.result, null);
  assert.equal(coreRequests, 1);
});

function argumentsFor() {
  return [
    "broadcast",
    "marketing-settings",
    "read",
    "--workspace",
    "fonte",
    "--environment",
    "production",
    "--json",
  ];
}

function dependencies(fetcher, authorize = async () => bearer) {
  return {
    cwd: process.cwd(),
    randomUUID: () => "10000000-0000-4000-8000-000000000299",
    runner: { run: async () => 1 },
    operator: {
      configUrl,
      fetch: fetcher,
      authorize,
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
