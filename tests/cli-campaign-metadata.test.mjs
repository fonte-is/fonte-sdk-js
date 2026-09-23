import assert from "node:assert/strict";
import test from "node:test";

import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import { parseCampaignOperatorArguments } from "../packages/cli/dist/operator-campaign-arguments.js";
import { createCampaignMetadataClient } from "../packages/cli/dist/operator-campaign-client.js";
import { runCampaignOperatorCommand } from "../packages/cli/dist/operator-campaign-run.js";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignA = "11111111-1111-4111-8111-111111111111";
const campaignB = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const contexts = [
  {
    workspace_id: workspaceId,
    account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workspace_slug: "acme-workspace",
    workspace_code: "acme",
    display_name: "Acme",
    role: "operator",
    available_environments: ["sandbox", "production"],
  },
];

function configuration(campaignId, revision = 1, archived = false) {
  return {
    workspaceId,
    environment: "sandbox",
    campaignId,
    revision,
    title: "Autumn",
    description: "Seasonal planning",
    archived,
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: `2026-09-23T12:0${revision}:00.000Z`,
    scopeBindingStatus: "not_qualified",
  };
}

function commandEnvelope(
  campaignId,
  revision = 1,
  replayed = false,
  commandKind = "create",
) {
  return {
    schemaVersion: "campaign_configuration.v1",
    tenantId: workspaceId,
    environment: "sandbox",
    configuration: configuration(campaignId, revision),
    receipt: {
      operationId,
      commandKind,
      campaignId,
      resultingRevision: revision,
      committedAt: "2026-09-23T12:05:00.000Z",
    },
    replayed,
  };
}

function requester(responses) {
  const calls = [];
  return {
    calls,
    request: async (path, options) => {
      calls.push({ path, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test("Campaign parser is explicit, strict, and uses caller-owned UUIDs", () => {
  const parsed = parseCampaignOperatorArguments([
    "campaign",
    "create",
    "--workspace",
    "acme-workspace",
    "--environment",
    "sandbox",
    "--campaign-id",
    campaignA,
    "--operation-id",
    operationId,
    "--title",
    "Autumn",
    "--description",
    "",
    "--json",
  ]);
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.command, {
    kind: "campaign_create",
    workspace: "acme-workspace",
    environment: "sandbox",
    campaignId: campaignA,
    operationId,
    title: "Autumn",
    description: "",
  });
  assert.throws(() =>
    parseCampaignOperatorArguments([
      "campaign",
      "list",
      "--workspace",
      "acme-workspace",
    ]),
  );
  assert.throws(() =>
    parseCampaignOperatorArguments([
      "campaign",
      "list",
      "--workspace",
      "acme-workspace",
      "--environment",
      "sandbox",
      "--limit",
      "51",
    ]),
  );
  assert.throws(() =>
    parseCampaignOperatorArguments([
      "campaign",
      "read",
      "--workspace",
      "acme-workspace",
      "--environment",
      "sandbox",
      "--campaign-id",
      campaignA,
      "--campaign-id",
      campaignB,
    ]),
  );
});

test("Campaign list keeps same-name IDs distinct and sends the exact scoped page request", async () => {
  const list = {
    schemaVersion: "campaign_configuration.v1",
    tenantId: workspaceId,
    environment: "sandbox",
    configurations: [
      configuration(campaignA),
      { ...configuration(campaignB), updatedAt: "2026-09-23T12:02:00.000Z" },
    ],
    nextCursor: null,
  };
  const { calls, request } = requester([list]);
  const client = createCampaignMetadataClient(request, async () => contexts);
  const result = await client.list({
    workspace: "acme-workspace",
    environment: "sandbox",
    limit: 25,
    includeArchived: true,
    cursor: "page/one",
  });
  assert.equal(result, list);
  assert.deepEqual(
    result.configurations.map((item) => [item.campaignId, item.title]),
    [
      [campaignA, "Autumn"],
      [campaignB, "Autumn"],
    ],
  );
  assert.equal(
    calls[0].path,
    "/v1/workspaces/acme-workspace/campaign-configurations?environment=sandbox&limit=25&includeArchived=true&cursor=page%2Fone",
  );
  assert.deepEqual(calls[0].options, { timeoutMs: 10_000 });
});

test("Campaign create and update preserve exact Core methods, IDs, and full update content", async () => {
  const created = commandEnvelope(campaignA);
  const updated = commandEnvelope(campaignA, 2, false, "update");
  const { calls, request } = requester([created, updated]);
  const client = createCampaignMetadataClient(request, async () => contexts);
  assert.equal(
    await client
      .create({
        workspace: "acme-workspace",
        environment: "sandbox",
        campaignId: campaignA,
        operationId,
        title: "Autumn",
        description: "Seasonal planning",
      })
      .then((result) => result),
    created,
  );
  assert.equal(
    await client.update({
      workspace: "acme-workspace",
      environment: "sandbox",
      campaignId: campaignA,
      operationId,
      expectedRevision: 1,
      title: "Autumn",
      description: "Seasonal planning",
      archived: true,
    }),
    updated,
  );
  assert.deepEqual(
    calls.map(({ path, options }) => [
      path,
      options?.method ?? "POST",
      options?.body,
      options?.idempotencyKey,
    ]),
    [
      [
        "/v1/workspaces/acme-workspace/campaign-configurations?environment=sandbox",
        "POST",
        {
          campaignId: campaignA,
          operationId,
          title: "Autumn",
          description: "Seasonal planning",
        },
        operationId,
      ],
      [
        "/v1/workspaces/acme-workspace/campaign-configurations/11111111-1111-4111-8111-111111111111?environment=sandbox",
        "PATCH",
        {
          operationId,
          expectedRevision: 1,
          title: "Autumn",
          description: "Seasonal planning",
          archived: true,
        },
        operationId,
      ],
    ],
  );
  assert.equal(calls[0].options.timeoutMs, 10_000);
  assert.equal(calls[1].options.timeoutMs, 10_000);
});

test("Campaign receipt recovery reads once and returns the receipt revision rather than current head", async () => {
  const recoveredReceipt = commandEnvelope(campaignA, 2, true, "update");
  const { calls, request } = requester([
    new CoreOperatorError("core_api_unavailable", null, "unknown"),
    recoveredReceipt,
  ]);
  const client = createCampaignMetadataClient(request, async () => contexts);
  const result = await client.update({
    workspace: "acme-workspace",
    environment: "sandbox",
    campaignId: campaignA,
    operationId,
    expectedRevision: 1,
    title: "Autumn",
    description: "Seasonal planning",
    archived: false,
  });
  assert.equal(result, recoveredReceipt);
  assert.equal(result.configuration.revision, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(
    calls[1].path,
    `/v1/workspaces/acme-workspace/campaign-configurations/commands/${operationId}?environment=sandbox`,
  );
  assert.deepEqual(calls[1].options, { timeoutMs: 10_000 });
});

test("Campaign receipt 404 race retains unknown effect and the exact next action without resubmitting", async () => {
  const { calls, request } = requester([
    new CoreOperatorError("core_api_unavailable", null, "unknown"),
    new CoreOperatorError("command_receipt_not_found", 404, "none"),
  ]);
  const client = createCampaignMetadataClient(request, async () => contexts);
  const command = {
    kind: "campaign_create",
    workspace: "acme-workspace",
    environment: "sandbox",
    campaignId: campaignA,
    operationId,
    title: "Autumn",
  };
  const receipt = await runCampaignOperatorCommand(command, client);
  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "core_api_unavailable");
  assert.equal(receipt.core_effect, "unknown");
  assert.deepEqual(receipt.next_action, {
    kind: "read_campaign_command",
    workspace: "acme-workspace",
    environment: "sandbox",
    operation_id: operationId,
    resource_id: campaignA,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].path, /\/commands\//u);
});

test("Campaign context mismatch and stale conflicts stop before recovery", async () => {
  const mismatch = requester([
    {
      schemaVersion: "campaign_configuration.v1",
      tenantId: workspaceId,
      environment: "sandbox",
      configuration: configuration(campaignA),
    },
  ]);
  const client = createCampaignMetadataClient(mismatch.request, async () => [
    {
      ...contexts[0],
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  ]);
  await assert.rejects(
    client.read({
      workspace: "acme-workspace",
      environment: "sandbox",
      campaignId: campaignA,
    }),
    { reason: "core_operator_receipt_invalid" },
  );
  assert.equal(mismatch.calls.length, 1);

  for (const reason of ["revision_conflict", "operation_conflict"]) {
    const conflict = requester([new CoreOperatorError(reason, 409, "none")]);
    const conflictClient = createCampaignMetadataClient(
      conflict.request,
      async () => contexts,
    );
    await assert.rejects(
      conflictClient.update({
        workspace: "acme-workspace",
        environment: "sandbox",
        campaignId: campaignA,
        operationId,
        expectedRevision: 1,
        title: "Autumn",
        description: "",
        archived: false,
      }),
      { reason },
    );
    assert.equal(conflict.calls.length, 1);
  }
});
