import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MCP_SEQUENCE_TOOLS } from "../packages/cli/dist/mcp-sequence-tools.js";
import {
  MCP_CAMPAIGN_SEGMENT_TOOLS,
  MCP_FONTE_ALLOWLIST,
  MCP_FONTE_TOOLS,
} from "../packages/cli/dist/mcp-sequence-server.js";
import { MCP_CAMPAIGN_TOOLS } from "../packages/cli/dist/mcp-campaign-tools.js";
import { MCP_SEGMENT_TOOLS } from "../packages/cli/dist/mcp-segment-tools.js";
import { createCampaignToolHandlers } from "../packages/cli/dist/mcp-campaign-tools.js";
import { createSegmentToolHandlers } from "../packages/cli/dist/mcp-segment-tools.js";
import { runCampaignOperatorCommand } from "../packages/cli/dist/operator-campaign-run.js";
import { runSegmentOperatorCommand } from "../packages/cli/dist/operator-segment-run.js";
import { campaignOperatorReceiptSchema } from "../packages/cli/dist/mcp-campaign-types.js";
import { segmentOperatorReceiptSchema } from "../packages/cli/dist/mcp-segment-types.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import {
  createCampaignInputSchema,
  updateCampaignInputSchema,
} from "../packages/cli/dist/mcp-campaign-types.js";
import {
  createSegmentInputSchema,
  setSegmentArchivedInputSchema,
} from "../packages/cli/dist/mcp-segment-types.js";

const fixture = fileURLToPath(
  new URL("./fixtures/cli-mcp-campaign-segment-stdio.mjs", import.meta.url),
);

test("metadata tools register beside the existing Sequence tools on one live stdio host", async () => {
  const host = await startMcp(fixture);
  try {
    const initialized = await host.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "fonte-metadata-test", version: "1.0.0" },
    });
    assert.equal(initialized.result.serverInfo.name, "fonte");
    host.notify("notifications/initialized", {});

    const listed = await host.request("tools/list", {});
    const tools = listed.result.tools;
    const names = tools.map((tool) => tool.name);
    assert.deepEqual(
      names.filter((name) => MCP_SEQUENCE_TOOLS.includes(name)),
      [...MCP_SEQUENCE_TOOLS],
    );
    assert.deepEqual(
      names.filter((name) => MCP_CAMPAIGN_TOOLS.includes(name)),
      [...MCP_CAMPAIGN_TOOLS],
    );
    assert.deepEqual(
      names.filter((name) => MCP_SEGMENT_TOOLS.includes(name)),
      [...MCP_SEGMENT_TOOLS],
    );
    assert.deepEqual(names, [...MCP_CAMPAIGN_SEGMENT_TOOLS]);
    assert.deepEqual(MCP_FONTE_ALLOWLIST, { tools: MCP_FONTE_TOOLS });
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.length, 20);
    const campaignCreate = tools.find(
      (tool) => tool.name === "fonte_create_campaign",
    );
    assert.equal(campaignCreate.annotations.readOnlyHint, false);
    assert.equal(campaignCreate.annotations.destructiveHint, false);
    assert.equal(campaignCreate.annotations.idempotentHint, true);
    assert.equal(campaignCreate.annotations.openWorldHint, false);
    const segmentRead = tools.find(
      (tool) => tool.name === "fonte_read_segment",
    );
    assert.equal(segmentRead.annotations.readOnlyHint, true);

    const campaignCall = await host.request("tools/call", {
      name: "fonte_list_campaigns",
      arguments: { workspace: "acme-workspace", environment: "sandbox" },
    });
    const campaignReceipt = JSON.parse(campaignCall.result.content[0].text);
    assert.deepEqual(campaignCall.result.structuredContent, campaignReceipt);
    assert.equal(
      campaignReceipt.schema_version,
      "fonte.cli.operator_receipt.v1",
    );
    assert.equal(
      campaignReceipt.authority.contract_id,
      "fonte.core.campaign_configuration.v1",
    );
    assert.equal(
      campaignReceipt.result.configurations[0].campaignId,
      "11111111-1111-4111-8111-111111111111",
    );

    const segmentCall = await host.request("tools/call", {
      name: "fonte_list_segments",
      arguments: { workspace: "acme-workspace", environment: "sandbox" },
    });
    const segmentReceipt = JSON.parse(segmentCall.result.content[0].text);
    assert.deepEqual(segmentCall.result.structuredContent, segmentReceipt);
    assert.equal(
      segmentReceipt.authority.contract_id,
      "fonte.core.native_segment.v1",
    );
    assert.equal(
      segmentReceipt.result.segments[0].segmentId,
      "22222222-2222-4222-8222-222222222222",
    );
  } finally {
    host.close();
  }
});

test("MCP metadata schemas reject unknown fields and require replay-safe identifiers", () => {
  assert.equal(
    createCampaignInputSchema.safeParse({
      workspace: "acme-workspace",
      environment: "sandbox",
      campaignId: "11111111-1111-4111-8111-111111111111",
      operationId: "33333333-3333-4333-8333-333333333333",
      title: "Autumn",
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    updateCampaignInputSchema.safeParse({
      workspace: "acme-workspace",
      environment: "sandbox",
      campaignId: "11111111-1111-4111-8111-111111111111",
      operationId: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 1,
      title: "Autumn",
      description: "",
      archived: false,
    }).success,
    true,
  );
  assert.equal(
    createSegmentInputSchema.safeParse({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: "22222222-2222-4222-8222-222222222222",
      operationId: "33333333-3333-4333-8333-333333333333",
      title: "Active",
      rule: { schemaVersion: "native_rule.v1", root: { any: true } },
    }).success,
    true,
  );
  assert.equal(
    setSegmentArchivedInputSchema.safeParse({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: "22222222-2222-4222-8222-222222222222",
      operationId: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 1,
      archived: true,
    }).success,
    true,
  );
  assert.equal(
    createSegmentInputSchema.safeParse({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: "22222222-2222-4222-8222-222222222222",
      title: "Active",
      rule: {},
    }).success,
    false,
  );
});

test("CLI and MCP handlers emit the same OperatorReceipt schema for success and errors", async () => {
  const campaignEnvelope = {
    schemaVersion: "campaign_configuration.v1",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    environment: "sandbox",
    configurations: [],
    nextCursor: null,
  };
  const campaignClient = { list: async () => campaignEnvelope };
  const campaignCommand = {
    kind: "campaign_list",
    workspace: "acme-workspace",
    environment: "sandbox",
  };
  const cliCampaign = await runCampaignOperatorCommand(
    campaignCommand,
    campaignClient,
  );
  const mcpCampaign = await createCampaignToolHandlers(
    async () => campaignClient,
  ).list({
    workspace: "acme-workspace",
    environment: "sandbox",
  });
  assert.deepEqual(mcpCampaign, cliCampaign);
  assert.equal(
    campaignOperatorReceiptSchema.safeParse(cliCampaign).success,
    true,
  );

  const segmentEnvelope = {
    schemaVersion: "native_segment.v1",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    environment: "sandbox",
    segments: [],
    nextCursor: null,
  };
  const segmentClient = { list: async () => segmentEnvelope };
  const segmentCommand = {
    kind: "segment_list",
    workspace: "acme-workspace",
    environment: "sandbox",
  };
  const cliSegment = await runSegmentOperatorCommand(
    segmentCommand,
    segmentClient,
  );
  const mcpSegment = await createSegmentToolHandlers(
    async () => segmentClient,
  ).list({
    workspace: "acme-workspace",
    environment: "sandbox",
  });
  assert.deepEqual(mcpSegment, cliSegment);
  assert.equal(
    segmentOperatorReceiptSchema.safeParse(cliSegment).success,
    true,
  );

  const failingCampaignClient = {
    list: async () => {
      throw new CoreOperatorError("revision_conflict", 409, "none");
    },
  };
  const cliBlocked = await runCampaignOperatorCommand(
    campaignCommand,
    failingCampaignClient,
  );
  const mcpBlocked = await createCampaignToolHandlers(
    async () => failingCampaignClient,
  ).list({
    workspace: "acme-workspace",
    environment: "sandbox",
  });
  assert.deepEqual(mcpBlocked, cliBlocked);
  assert.equal(cliBlocked.core_effect, "none");
  assert.equal(cliBlocked.result, null);
});

async function startMcp(script) {
  const child = spawn(process.execPath, [script], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  let stderr = "";
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if ("id" in message) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const request = (method, params) => {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for ${method}: ${stderr}`)),
        5_000,
      );
      pending.set(requestId, (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });
  };
  return {
    request,
    notify(method, params) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    close() {
      lines.close();
      child.kill("SIGTERM");
    },
  };
}
