import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { operatorHelp } from "../packages/cli/dist/operator-help.js";
import {
  CoreOperatorError,
  createCoreRequester,
} from "../packages/cli/dist/operator-core-request.js";
import { createCampaignMetadataClient } from "../packages/cli/dist/operator-campaign-client.js";
import { createSegmentMetadataClient } from "../packages/cli/dist/operator-segment-client.js";
import { runOperatorCommand } from "../packages/cli/dist/operator-run.js";

const workspace = "acme-workspace";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "11111111-1111-4111-8111-111111111111";
const segmentId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const hostedConfigUrl = "http://127.0.0.1:43112/.well-known/fonte-cli.json";
const hostedConfig = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("shared CLI dispatcher admits metadata commands and help", () => {
  const campaign = parseArguments([
    "campaign",
    "update",
    "--workspace",
    workspace,
    "--environment",
    "sandbox",
    "--campaign-id",
    campaignId,
    "--operation-id",
    operationId,
    "--expected-revision",
    "2",
    "--title",
    "Autumn",
    "--description",
    "Reminder",
    "--archived",
    "false",
    "--json",
  ]);
  assert.equal(campaign.command, "operator");
  assert.equal(campaign.operator.kind, "campaign_update");
  assert.equal(campaign.operator.expectedRevision, 2);
  assert.equal(campaign.json, true);

  const segment = parseArguments([
    "segment",
    "create",
    "--workspace",
    workspace,
    "--environment",
    "sandbox",
    "--segment-id",
    segmentId,
    "--operation-id",
    operationId,
    "--title",
    "Active",
    "--rule",
    JSON.stringify({ schemaVersion: "native_rule.v1", root: { any: true } }),
  ]);
  assert.equal(segment.command, "operator");
  assert.equal(segment.operator.kind, "segment_create");
  assert.deepEqual(segment.operator.rule, {
    schemaVersion: "native_rule.v1",
    root: { any: true },
  });

  assert.match(operatorHelp(["campaign", "--help"]), /campaign receipt/u);
  assert.match(operatorHelp(["segment", "create", "--help"]), /--rule/u);
});

test("metadata Core reads, including receipt recovery lookup, request a 10-second bound", async () => {
  const campaignCalls = [];
  const campaignClient = createCampaignMetadataClient(async (path, options) => {
    campaignCalls.push({ path, options });
    if (path.includes("/commands/")) return campaignCommandEnvelope();
    if (path.includes(`/${campaignId}?`)) return campaignReadEnvelope();
    return campaignListEnvelope();
  }, contexts);
  await campaignClient.list({ workspace, environment: "sandbox" });
  await campaignClient.read({ workspace, environment: "sandbox", campaignId });
  await campaignClient.readCommand({
    workspace,
    environment: "sandbox",
    operationId,
  });

  const segmentCalls = [];
  const segmentClient = createSegmentMetadataClient(async (path, options) => {
    segmentCalls.push({ path, options });
    if (path.includes("/commands/")) return segmentCommandEnvelope();
    if (path.includes(`/${segmentId}?`)) return segmentReadEnvelope();
    return segmentListEnvelope();
  }, contexts);
  await segmentClient.list({ workspace, environment: "sandbox" });
  await segmentClient.read({ workspace, environment: "sandbox", segmentId });
  await segmentClient.readCommand({
    workspace,
    environment: "sandbox",
    operationId,
  });

  assert.equal(
    [...campaignCalls, ...segmentCalls].every(
      ({ options }) => options?.timeoutMs === 10_000,
    ),
    true,
  );

  const scopeCalls = [];
  const scopedRequest = async (path, options) => {
    scopeCalls.push({ path, options });
    return path === "/v1/workspaces"
      ? workspaceContexts()
      : path.includes("campaign-configurations")
        ? campaignListEnvelope()
        : segmentListEnvelope();
  };
  await createCampaignMetadataClient(scopedRequest).list({
    workspace,
    environment: "sandbox",
  });
  await createSegmentMetadataClient(scopedRequest).list({
    workspace,
    environment: "sandbox",
  });
  assert.equal(
    scopeCalls.every(({ options }) => options?.timeoutMs === 10_000),
    true,
  );
});

test("shared CoreRequester applies a per-read timeout without changing its default", async () => {
  let requestSignal;
  const request = createCoreRequester({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic-bearer",
    fetch: async (_url, init) => {
      requestSignal = init.signal;
      await new Promise((resolve, reject) => {
        if (init.signal.aborted) return reject(init.signal.reason);
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          {
            once: true,
          },
        );
      });
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    request("/v1/workspaces", { timeoutMs: 10 }),
    (error) =>
      error instanceof CoreOperatorError &&
      error.reason === "core_api_unavailable" &&
      error.coreEffect === "none",
  );
  assert.equal(requestSignal.aborted, true);
});

test("Campaign dispatch returns the Core envelope through the shared operator receipt", async () => {
  const requests = [];
  const receipt = await runOperatorCommand(
    { kind: "campaign_list", workspace, environment: "sandbox" },
    operatorDependencies(async (input, init) => {
      const url = String(input);
      if (url === hostedConfigUrl) return json(hostedConfig);
      const coreUrl = new URL(url);
      requests.push({ path: coreUrl.pathname, method: init.method });
      if (coreUrl.pathname === "/v1/workspaces")
        return json(workspaceContexts());
      if (coreUrl.pathname.endsWith("/campaign-configurations")) {
        return json(campaignListEnvelope());
      }
      return json({ error: { code: "route_not_found" } }, 404);
    }),
    () => operationId,
  );

  assert.equal(receipt.outcome, "completed");
  assert.equal(
    receipt.authority.contract_id,
    "fonte.core.campaign_configuration.v1",
  );
  assert.equal(receipt.result.schemaVersion, "campaign_configuration.v1");
  assert.equal(receipt.result.configurations[0].campaignId, campaignId);
  assert.equal("kind" in receipt.result, false);
  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "GET"],
  );
});

test("shared CLI requester enforces the existing 1 MiB Core response cap", async () => {
  const receipt = await runOperatorCommand(
    { kind: "campaign_list", workspace, environment: "sandbox" },
    operatorDependencies(async (input) => {
      const url = String(input);
      if (url === hostedConfigUrl) return json(hostedConfig);
      const coreUrl = new URL(url);
      if (coreUrl.pathname === "/v1/workspaces")
        return json(workspaceContexts());
      if (coreUrl.pathname.endsWith("/campaign-configurations")) {
        return json({ padding: "x".repeat(1_048_577) });
      }
      return json({ error: { code: "route_not_found" } }, 404);
    }),
    () => operationId,
  );
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "core_response_too_large");
  assert.equal(receipt.core_effect, "none");
});

test("Segment CLI unknown outcome performs one receipt read and preserves replay", async () => {
  const parsed = parseArguments([
    "segment",
    "create",
    "--workspace",
    workspace,
    "--environment",
    "sandbox",
    "--segment-id",
    segmentId,
    "--operation-id",
    operationId,
    "--title",
    "Active",
    "--rule",
    JSON.stringify({ schemaVersion: "native_rule.v1", root: { any: true } }),
    "--json",
  ]);
  const calls = [];
  const receipt = await runOperatorCommand(
    parsed.operator,
    operatorDependencies(async (input, init) => {
      const url = String(input);
      if (url === hostedConfigUrl) return json(hostedConfig);
      const coreUrl = new URL(url);
      calls.push({ path: coreUrl.pathname, method: init.method });
      if (coreUrl.pathname === "/v1/workspaces")
        return json(workspaceContexts());
      if (coreUrl.pathname.endsWith("/segments")) {
        throw new Error("simulated lost mutation response");
      }
      if (coreUrl.pathname.endsWith(`/segments/commands/${operationId}`)) {
        return json(segmentCommandEnvelope({ replayed: true }));
      }
      return json({ error: { code: "route_not_found" } }, 404);
    }),
    () => operationId,
  );

  assert.equal(receipt.outcome, "completed");
  assert.equal(receipt.authority.contract_id, "fonte.core.native_segment.v1");
  assert.equal(receipt.core_effect, "none");
  assert.equal(receipt.result.replayed, true);
  assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
  assert.equal(
    calls.filter(({ path }) =>
      path.endsWith(`/segments/commands/${operationId}`),
    ).length,
    1,
  );
});

function operatorDependencies(fetch) {
  return {
    configUrl: hostedConfigUrl,
    fetch,
    authorize: async () => "synthetic-bearer",
    sleep: async () => {},
    readProviderEvidenceCandidateFile: async () => null,
    readProviderPlacementApplicationFile: async () => null,
  };
}

function contexts() {
  return workspaceContexts().workspaces.map((item) => ({
    workspace_id: item.workspaceId,
    account_id: item.accountId,
    workspace_slug: item.workspaceSlug,
    workspace_code: item.workspaceCode,
    display_name: item.displayName,
    role: item.role,
    available_environments: item.availableEnvironments,
  }));
}

function workspaceContexts() {
  return {
    workspaces: [
      {
        workspaceId: tenantId,
        tenantId,
        accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        slug: workspace,
        workspaceSlug: workspace,
        workspaceCode: "acme",
        displayName: "Acme",
        role: "operator",
        availableEnvironments: ["sandbox"],
      },
    ],
  };
}

function campaignConfiguration() {
  return {
    workspaceId: tenantId,
    environment: "sandbox",
    campaignId,
    revision: 1,
    title: "Autumn",
    description: "",
    archived: false,
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T12:00:00.000Z",
    scopeBindingStatus: "not_qualified",
  };
}

function campaignListEnvelope() {
  return {
    schemaVersion: "campaign_configuration.v1",
    tenantId,
    environment: "sandbox",
    configurations: [campaignConfiguration()],
    nextCursor: null,
  };
}

function campaignReadEnvelope() {
  return {
    schemaVersion: "campaign_configuration.v1",
    tenantId,
    environment: "sandbox",
    configuration: campaignConfiguration(),
  };
}

function campaignCommandEnvelope() {
  return {
    schemaVersion: "campaign_configuration.v1",
    tenantId,
    environment: "sandbox",
    configuration: campaignConfiguration(),
    receipt: {
      operationId,
      commandKind: "create",
      campaignId,
      resultingRevision: 1,
      committedAt: "2026-09-23T12:00:00.000Z",
    },
    replayed: false,
  };
}

function segmentRevision() {
  return {
    segmentId,
    revision: 1,
    title: "Active",
    rule: { schemaVersion: "native_rule.v1", root: { any: true } },
    ruleDigest: "a".repeat(64),
    semanticsVersion: "native_rule.v1",
    archived: false,
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T12:00:00.000Z",
  };
}

function segmentListEnvelope() {
  return {
    schemaVersion: "native_segment.v1",
    tenantId,
    environment: "sandbox",
    segments: [
      {
        segmentId,
        revision: 1,
        title: "Active",
        archived: false,
        createdAt: "2026-09-23T12:00:00.000Z",
        updatedAt: "2026-09-23T12:00:00.000Z",
      },
    ],
    nextCursor: null,
  };
}

function segmentReadEnvelope() {
  return {
    schemaVersion: "native_segment.v1",
    tenantId,
    environment: "sandbox",
    segment: segmentRevision(),
  };
}

function segmentCommandEnvelope({ replayed = false } = {}) {
  return {
    schemaVersion: "native_segment.v1",
    tenantId,
    environment: "sandbox",
    segment: segmentRevision(),
    receipt: {
      operationId,
      commandKind: "create",
      segmentId,
      resultingRevision: 1,
      committedAt: "2026-09-23T12:00:00.000Z",
    },
    replayed,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
