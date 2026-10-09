import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import {
  audienceCountSelectionDigestV1, countBroadcastAudience,
} from "../packages/cli/dist/broadcast-audience-count-client.js";
import { parseAudienceCountArguments, renderAudienceCountResult } from "../packages/cli/dist/operator-audience-count-arguments.js";
import { createAudienceCountToolHandler, registerMcpAudienceCountTool, MCP_AUDIENCE_COUNT_TOOL } from "../packages/cli/dist/mcp-audience-count.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";

const valid = JSON.parse(readFileSync(new URL("./fixtures/audience-count-contract/valid.json", import.meta.url), "utf8"));
const action = JSON.parse(readFileSync(new URL("./fixtures/audience-count-contract/minimum-draft-exclusion-action.json", import.meta.url), "utf8"));
const errors = JSON.parse(readFileSync(new URL("./fixtures/audience-count-contract/errors.json", import.meta.url), "utf8"));
const fixtureInput = { workspace: "synthetic-workspace", draftId: valid.scope.draftId, request: valid.request };
const options = (url: string) => ({ coreApiBaseUrl: url, bearer: "synthetic-token", fetch,
  environment: "sandbox" as const, resolveWorkspaceId: async () => valid.scope.workspaceId });

async function server(reply: (request: { url: string; body: unknown; authorization: string | undefined }) => { status: number; body: unknown }) {
  const calls: { url: string; body: unknown; authorization: string | undefined }[] = [];
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const call = { url: request.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")), authorization: request.headers.authorization };
    calls.push(call);
    const result = reply(call);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("listener");
  return { url: `http://127.0.0.1:${address.port}`, calls, close: () => new Promise<void>(resolve => http.close(() => resolve())) };
}

test("fixture digest, one unsaved count POST and zero result", async () => {
  assert.equal(await audienceCountSelectionDigestV1(valid.scope.workspaceId, valid.scope.environment, valid.scope.draftId,
    { ...valid.request, recipientExpression: valid.normalizedRecipientExpression }), valid.selectionDigest);
  const local = await server(() => ({ status: 200, body: valid.result }));
  try {
    const result = await countBroadcastAudience(fixtureInput, options(local.url));
    assert.equal(result.recipientCount, 0);
    assert.equal(local.calls.length, 1);
    assert.equal(local.calls[0]?.url, `/v1/workspaces/synthetic-workspace/broadcast-drafts/${valid.scope.draftId}/audience-count?environment=sandbox`);
    assert.deepEqual(local.calls[0]?.body, { ...valid.request, recipientExpression: valid.normalizedRecipientExpression });
    assert.equal(local.calls[0]?.authorization, "Bearer synthetic-token");
  } finally { await local.close(); }
});

test("optional draft CSV action is forwarded unchanged and excluded from digest", async () => {
  const withAction = { workspace: fixtureInput.workspace, draftId: fixtureInput.draftId, request: action.request };
  assert.equal(await audienceCountSelectionDigestV1(action.scope.workspaceId, action.scope.environment,
    action.scope.draftId, action.request), valid.selectionDigest);
  const local = await server(() => ({ status: 200, body: valid.result }));
  try {
    assert.equal((await countBroadcastAudience(withAction, options(local.url))).recipientCount, 0);
    assert.equal(local.calls.length, 1);
    assert.equal((local.calls[0]?.body as { minimumDraftExclusionActionId: string }).minimumDraftExclusionActionId,
      action.minimumDraftExclusionActionId);
    assert.equal(parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(withAction)])
      ?.input.request.minimumDraftExclusionActionId, action.minimumDraftExclusionActionId);
  } finally { await local.close(); }
  assert.equal(Object.hasOwn(parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(fixtureInput)])!.input.request,
    "minimumDraftExclusionActionId"), false);
  let mcpAction: string | undefined;
  const handler = createAudienceCountToolHandler(async () => ({ count: async input => {
    mcpAction = input.request.minimumDraftExclusionActionId;
    return valid.result;
  } }));
  assert.equal((await handler(withAction)).count?.recipientCount, 0);
  assert.equal(mcpAction, action.minimumDraftExclusionActionId);
  for (const malformed of [null, "not-a-uuid", 13, undefined]) {
    const bad = { ...withAction, request: { ...withAction.request, minimumDraftExclusionActionId: malformed } };
    await assert.rejects(countBroadcastAudience(bad, options("http://127.0.0.1:1")), /audience_count_invalid_request/);
    if (malformed !== undefined)
      assert.throws(() => parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(bad)]));
  }
  const unknown = { ...withAction, request: { ...withAction.request, anotherFreshnessField: action.minimumDraftExclusionActionId } };
  await assert.rejects(countBroadcastAudience(unknown, options("http://127.0.0.1:1")), /audience_count_invalid_request/);
});

test("mismatch and oversized count receipts fail closed", async () => {
  for (const body of [{ ...valid.result, requestId: "00000000-0000-4000-8000-000000000099" },
    { ...valid.result, workspaceId: "00000000-0000-4000-8000-000000000099" },
    { ...valid.result, selectionDigest: "b".repeat(64) },
    { ...valid.result, recipients: [] }, { ...valid.result, padding: "x".repeat(9000) }]) {
    const local = await server(() => ({ status: 200, body }));
    try { await assert.rejects(countBroadcastAudience(fixtureInput, options(local.url)), /core_operator_receipt_invalid|core_response_too_large/); }
    finally { await local.close(); }
  }
});

test("source failure remains typed; incomplete and unknown CLI flags do not send", async () => {
  const sourceFailure = errors.errors.find((entry: { status: number }) => entry.status === 404);
  const local = await server(() => sourceFailure);
  try {
    await assert.rejects(countBroadcastAudience(fixtureInput, options(local.url)), (error: unknown) =>
      error instanceof CoreOperatorError && error.reason === "audience_source_unavailable" && error.statusCode === 404);
    const incomplete = { ...fixtureInput, request: { ...fixtureInput.request, recipientExpression: { include: [], exclude: [] } } };
    await assert.rejects(countBroadcastAudience(incomplete, options(local.url)), /audience_targeting_incomplete/);
    assert.equal(local.calls.length, 1);
    assert.throws(() => parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(incomplete)]));
    assert.throws(() => parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(fixtureInput), "--watch"]));
    assert.throws(() => parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(fixtureInput), "--count-input", JSON.stringify(fixtureInput)]));
    assert.equal(parseAudienceCountArguments(["broadcast", "audience-count", "--count-input", JSON.stringify(fixtureInput)])?.kind, "broadcast_audience_count");
    assert.equal(renderAudienceCountResult(valid.result, false), "0 recipients");
  } finally { await local.close(); }
});

test("MCP handler makes one count call and retains actual 403 reason", async () => {
  let calls = 0;
  const handler = createAudienceCountToolHandler(async () => ({ count: async () => { calls++; return valid.result; } }));
  assert.equal((await handler(fixtureInput)).count?.recipientCount, 0);
  assert.equal(calls, 1);
  const denied = createAudienceCountToolHandler(async () => ({ count: async () => {
    throw new CoreOperatorError("workspace_permission_denied", 403, "none");
  } }));
  assert.deepEqual(await denied(fixtureInput), { outcome: "failed", count: null, reason: "workspace_permission_denied", status_code: 403 });
  const registrations: Array<{ name: string; config: { annotations: { readOnlyHint: boolean; destructiveHint: boolean } } }> = [];
  registerMcpAudienceCountTool({ registerTool: (name: string, config: any) => { registrations.push({ name, config }); } } as any,
    async () => ({ count: async () => valid.result }));
  assert.equal(registrations[0]?.name, MCP_AUDIENCE_COUNT_TOOL);
  assert.deepEqual({ readOnlyHint: registrations[0]?.config.annotations.readOnlyHint,
    destructiveHint: registrations[0]?.config.annotations.destructiveHint }, { readOnlyHint: true, destructiveHint: false });
});

test("fixed capacity/timeout errors and origin validation never retry or leak bearer", async () => {
  for (const [status, code] of [[429, "audience_count_capacity_exceeded"], [503, "audience_count_unavailable"],
    [504, "audience_count_timeout"]] as const) {
    const fixedFailure = errors.errors.find((entry: { status: number }) => entry.status === status);
    assert.equal(fixedFailure.body.code, code);
    const local = await server(() => fixedFailure);
    try {
      await assert.rejects(countBroadcastAudience(fixtureInput, options(local.url)), (error: unknown) =>
        error instanceof CoreOperatorError && error.reason === code && error.statusCode === status);
      assert.equal(local.calls.length, 1);
    } finally { await local.close(); }
  }
  let sent = false;
  await assert.rejects(countBroadcastAudience(fixtureInput, { ...options("http://untrusted.example.test"),
    fetch: async () => { sent = true; throw new Error("should not send"); } }), /core_api_base_url_invalid/);
  assert.equal(sent, false);
});

test("fresh-process CLI parser and MCP handler consume the fixed fixture", () => {
  const script = `import {parseAudienceCountArguments,renderAudienceCountResult} from './packages/cli/dist/operator-audience-count-arguments.js';
import {createAudienceCountToolHandler} from './packages/cli/dist/mcp-audience-count.js';
const value=${JSON.stringify(fixtureInput)};
const parsed=parseAudienceCountArguments(['broadcast','audience-count','--count-input',JSON.stringify(value)]);
const result=${JSON.stringify(valid.result)};
const handler=createAudienceCountToolHandler(async()=>({count:async()=>result}));
console.log(JSON.stringify({command:parsed.kind,human:renderAudienceCountResult(result,false),mcp:(await handler(value)).count.recipientCount}));`;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim();
  assert.deepEqual(JSON.parse(output), { command: "broadcast_audience_count", human: "0 recipients", mcp: 0 });
});
