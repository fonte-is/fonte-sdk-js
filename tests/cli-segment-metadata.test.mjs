import assert from "node:assert/strict";
import test from "node:test";

import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import { parseSegmentOperatorArguments } from "../packages/cli/dist/operator-segment-arguments.js";
import { createSegmentMetadataClient } from "../packages/cli/dist/operator-segment-client.js";
import { runSegmentOperatorCommand } from "../packages/cli/dist/operator-segment-run.js";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const segmentA = "11111111-1111-4111-8111-111111111111";
const segmentB = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const operationId2 = "44444444-4444-4444-8444-444444444444";
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
const rule = {
  schemaVersion: "native_rule.v1",
  root: { kind: "all", children: [] },
};

function segment(segmentId, revision = 1, archived = false) {
  return {
    segmentId,
    revision,
    title: "Active customers",
    rule,
    ruleDigest: "f".repeat(64),
    semanticsVersion: "native_rule.v1",
    archived,
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: `2026-09-23T12:0${revision}:00.000Z`,
  };
}

function commandEnvelope(
  segmentId,
  revision = 1,
  replayed = false,
  commandKind = "create",
  archived = false,
  operation = operationId,
) {
  return {
    schemaVersion: "native_segment.v1",
    tenantId: workspaceId,
    environment: "sandbox",
    segment: segment(segmentId, revision, archived),
    receipt: {
      operationId: operation,
      commandKind,
      segmentId,
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

test("Segment parser accepts inline and bounded stdin rules without evaluating them", () => {
  const inline = parseSegmentOperatorArguments([
    "segment",
    "create",
    "--workspace",
    "acme-workspace",
    "--environment",
    "sandbox",
    "--segment-id",
    segmentA,
    "--operation-id",
    operationId,
    "--title",
    "Active customers",
    "--rule",
    JSON.stringify(rule),
    "--json",
  ]);
  assert.equal(inline.json, true);
  assert.deepEqual(inline.command.rule, rule);

  let reads = 0;
  const stdin = parseSegmentOperatorArguments(
    [
      "segment",
      "update",
      "--workspace",
      "acme-workspace",
      "--environment",
      "sandbox",
      "--segment-id",
      segmentA,
      "--operation-id",
      operationId,
      "--expected-revision",
      "1",
      "--title",
      "Active customers",
      "--rule",
      "-",
    ],
    () => {
      reads += 1;
      return Buffer.from(JSON.stringify(rule));
    },
  );
  assert.equal(reads, 1);
  assert.deepEqual(stdin.command.rule, rule);
  assert.throws(() =>
    parseSegmentOperatorArguments(
      [
        "segment",
        "create",
        "--workspace",
        "acme-workspace",
        "--environment",
        "sandbox",
        "--segment-id",
        segmentA,
        "--operation-id",
        operationId,
        "--title",
        "Customers",
        "--rule",
        "-",
      ],
      () => Buffer.alloc(65_537),
    ),
  );
  assert.throws(() =>
    parseSegmentOperatorArguments([
      "segment",
      "list",
      "--workspace",
      "acme-workspace",
      "--environment",
      "sandbox",
      "--environment",
      "production",
    ]),
  );
});

test("Segment list and exact/current reads preserve the native Core envelopes", async () => {
  const list = {
    schemaVersion: "native_segment.v1",
    tenantId: workspaceId,
    environment: "sandbox",
    segments: [
      {
        segmentId: segmentA,
        revision: 2,
        title: "Active customers",
        archived: false,
        createdAt: "2026-09-23T12:00:00.000Z",
        updatedAt: "2026-09-23T12:02:00.000Z",
      },
      {
        segmentId: segmentB,
        revision: 1,
        title: "Active customers",
        archived: false,
        createdAt: "2026-09-23T12:00:00.000Z",
        updatedAt: "2026-09-23T12:01:00.000Z",
      },
    ],
    nextCursor: null,
  };
  const exact = {
    schemaVersion: "native_segment.v1",
    tenantId: workspaceId,
    environment: "sandbox",
    segment: segment(segmentA, 1),
  };
  const current = {
    schemaVersion: "native_segment.v1",
    tenantId: workspaceId,
    environment: "sandbox",
    segment: segment(segmentA, 2),
  };
  const { calls, request } = requester([list, exact, current]);
  const client = createSegmentMetadataClient(request, async () => contexts);
  assert.equal(
    await client.list({
      workspace: "acme-workspace",
      environment: "sandbox",
      limit: 25,
      cursor: "next/one",
      includeArchived: false,
    }),
    list,
  );
  assert.equal(
    await client.read({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      revision: 1,
    }),
    exact,
  );
  assert.equal(
    await client.read({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
    }),
    current,
  );
  assert.deepEqual(
    calls.map((call) => call.path),
    [
      "/v1/workspaces/acme-workspace/segments?environment=sandbox&limit=25&includeArchived=false&cursor=next%2Fone",
      `/v1/workspaces/acme-workspace/segments/${segmentA}?environment=sandbox&revision=1`,
      `/v1/workspaces/acme-workspace/segments/${segmentA}?environment=sandbox`,
    ],
  );
  assert.equal("rule" in list.segments[0], false);
  assert.deepEqual(exact.segment.rule, rule);
});

test("Segment create, update, archive, and restore use exact Core methods and revision inputs", async () => {
  const created = commandEnvelope(segmentA);
  const updated = commandEnvelope(segmentA, 2, false, "update");
  const archived = commandEnvelope(
    segmentA,
    3,
    false,
    "setArchived",
    true,
    operationId2,
  );
  const restored = commandEnvelope(
    segmentA,
    4,
    false,
    "setArchived",
    false,
    "55555555-5555-4555-8555-555555555555",
  );
  const { calls, request } = requester([created, updated, archived, restored]);
  const client = createSegmentMetadataClient(request, async () => contexts);
  assert.equal(
    await client.create({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId,
      title: "Active customers",
      rule,
    }),
    created,
  );
  assert.equal(
    await client.update({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId,
      expectedRevision: 1,
      title: "Active customers",
      rule,
    }),
    updated,
  );
  assert.equal(
    await client.setArchived({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId: operationId2,
      expectedRevision: 2,
      archived: true,
    }),
    archived,
  );
  assert.equal(
    await client.setArchived({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId: "55555555-5555-4555-8555-555555555555",
      expectedRevision: 3,
      archived: false,
    }),
    restored,
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
        "/v1/workspaces/acme-workspace/segments?environment=sandbox",
        "POST",
        { segmentId: segmentA, operationId, title: "Active customers", rule },
        operationId,
      ],
      [
        `/v1/workspaces/acme-workspace/segments/${segmentA}?environment=sandbox`,
        "PATCH",
        { operationId, expectedRevision: 1, title: "Active customers", rule },
        operationId,
      ],
      [
        `/v1/workspaces/acme-workspace/segments/${segmentA}/archive?environment=sandbox`,
        "POST",
        { operationId: operationId2, expectedRevision: 2, archived: true },
        operationId2,
      ],
      [
        `/v1/workspaces/acme-workspace/segments/${segmentA}/archive?environment=sandbox`,
        "POST",
        {
          operationId: "55555555-5555-4555-8555-555555555555",
          expectedRevision: 3,
          archived: false,
        },
        "55555555-5555-4555-8555-555555555555",
      ],
    ],
  );
  assert.ok(calls.every((call) => call.options.timeoutMs === 10_000));
});

test("Segment receipt recovery performs one read and retains the persisted createdAt", async () => {
  const recovered = commandEnvelope(segmentA, 2, true, "update");
  const { calls, request } = requester([
    new CoreOperatorError("core_api_unavailable", null, "unknown"),
    recovered,
  ]);
  const client = createSegmentMetadataClient(request, async () => contexts);
  const result = await client.update({
    workspace: "acme-workspace",
    environment: "sandbox",
    segmentId: segmentA,
    operationId,
    expectedRevision: 1,
    title: "Active customers",
    rule,
  });
  assert.equal(result, recovered);
  assert.equal(result.segment.createdAt, "2026-09-23T12:00:00.000Z");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].path,
    `/v1/workspaces/acme-workspace/segments/commands/${operationId}?environment=sandbox`,
  );
});

test("Segment receipt 404 race remains unknown with the exact one-read next action", async () => {
  const { calls, request } = requester([
    new CoreOperatorError("core_api_unavailable", null, "unknown"),
    new CoreOperatorError("command_receipt_not_found", 404, "none"),
  ]);
  const client = createSegmentMetadataClient(request, async () => contexts);
  const receipt = await runSegmentOperatorCommand(
    {
      kind: "segment_archive",
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId,
      expectedRevision: 1,
      archived: true,
    },
    client,
  );
  assert.equal(receipt.core_effect, "unknown");
  assert.deepEqual(receipt.next_action, {
    kind: "read_segment_command",
    workspace: "acme-workspace",
    environment: "sandbox",
    operation_id: operationId,
    resource_id: segmentA,
  });
  assert.equal(calls.length, 2);
});

test("Segment scope mismatch and stale revisions fail closed without rule inference", async () => {
  const mismatched = requester([
    {
      schemaVersion: "native_segment.v1",
      tenantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      environment: "sandbox",
      segment: segment(segmentA),
    },
  ]);
  const client = createSegmentMetadataClient(
    mismatched.request,
    async () => contexts,
  );
  await assert.rejects(
    client.read({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
    }),
    {
      reason: "core_operator_receipt_invalid",
    },
  );
  assert.equal(mismatched.calls.length, 1);

  const stale = requester([
    new CoreOperatorError("revision_conflict", 409, "none"),
  ]);
  const staleClient = createSegmentMetadataClient(
    stale.request,
    async () => contexts,
  );
  await assert.rejects(
    staleClient.update({
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId,
      expectedRevision: 1,
      title: "Active customers",
      rule,
    }),
    { reason: "revision_conflict" },
  );
  assert.equal(stale.calls.length, 1);
});

test("Segment cancellation suppresses receipt recovery while preserving the unknown outcome", async () => {
  const controller = new AbortController();
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    controller.abort();
    throw new CoreOperatorError("operation_cancelled", null, "unknown");
  };
  const client = createSegmentMetadataClient(
    request,
    async () => contexts,
    controller.signal,
  );
  const receipt = await runSegmentOperatorCommand(
    {
      kind: "segment_create",
      workspace: "acme-workspace",
      environment: "sandbox",
      segmentId: segmentA,
      operationId,
      title: "Active customers",
      rule,
    },
    client,
  );
  assert.equal(receipt.core_effect, "unknown");
  assert.equal(receipt.next_action.kind, "read_segment_command");
  assert.equal(calls.length, 1);
});
