import assert from "node:assert/strict";
import test from "node:test";

import {
  createEphemeralSequenceMcpSession,
  MCP_SEQUENCE_ALLOWLIST,
} from "../packages/cli/dist/mcp-sequence-server.js";
import {
  createSequenceToolHandlers,
  MCP_SEQUENCE_TOOLS,
} from "../packages/cli/dist/mcp-sequence-tools.js";
import { createCoreRequester } from "../packages/cli/dist/operator-core-request.js";
import { createSequenceAuthoringClient } from "../packages/cli/dist/operator-sequence-client.js";
import {
  activationBinding,
  activatedVersion,
  bearer,
  configUrl,
  definition,
  hostedConfig,
  json,
  plan,
  sequenceId,
  sequenceRoute,
  workspace,
} from "./cli-sequence-authoring-support.mjs";

const scope = { workspace, environment: "sandbox" };

test("Sequence MCP has one closed authoring and activation tool allowlist and no resources", () => {
  assert.deepEqual(MCP_SEQUENCE_TOOLS, [
    "fonte_list_sequences",
    "fonte_read_sequence",
    "fonte_create_sequence",
    "fonte_update_sequence",
    "fonte_validate_sequence",
    "fonte_diff_sequence",
    "fonte_export_sequence",
    "fonte_simulate_sequence",
    "fonte_activate_sequence",
  ]);
  assert.deepEqual(MCP_SEQUENCE_ALLOWLIST, { tools: MCP_SEQUENCE_TOOLS });
  assert.equal("resources" in MCP_SEQUENCE_ALLOWLIST, false);
});

test("Sequence MCP tools preserve the Core authoring inputs and results", async () => {
  const calls = [];
  const handlers = createSequenceToolHandlers(async () =>
    recordingClient(calls),
  );
  await assertDraftTools(handlers);
  await assertInspectionTools(handlers);
  await assertActivationTool(handlers);
  assertCoreInputs(calls);
  await assert.rejects(
    handlers.create({
      ...scope,
      sequence_id: sequenceId,
      operation_key: "rejected-recipient-input",
      definition,
      recipient: { email: "someone@example.test" },
    }),
  );
  await assert.rejects(
    handlers.activate({
      ...activationInput(),
      recipient: { email: "someone@example.test" },
    }),
  );
  assert.equal(calls.length, 9);
});

test("ambiguous MCP draft mutations are reported once and never retried", async () => {
  let requests = 0;
  const requester = createCoreRequester({
    coreApiBaseUrl: "http://127.0.0.1:43112",
    bearer,
    fetch: async () => {
      requests += 1;
      throw new Error("response lost after Core may have persisted the draft");
    },
  });
  const handlers = createSequenceToolHandlers(async () =>
    createSequenceAuthoringClient(requester),
  );
  const result = await handlers.create({
    ...scope,
    sequence_id: sequenceId,
    operation_key: "create-welcome",
    definition,
  });

  assert.deepEqual(result, {
    outcome: "ambiguous",
    reason: "core_api_unavailable",
    status_code: null,
    core_effect: "unknown",
    sequence: null,
  });
  assert.equal(requests, 1);
});

test("ambiguous MCP Sequence activation is reported once and never retried", async () => {
  let requests = 0;
  const requester = createCoreRequester({
    coreApiBaseUrl: "http://127.0.0.1:43112",
    bearer,
    fetch: async () => {
      requests += 1;
      throw new Error("response lost after Core may have activated a version");
    },
  });
  const handlers = createSequenceToolHandlers(async () =>
    createSequenceAuthoringClient(requester),
  );
  const result = await handlers.activate(activationInput());

  assert.deepEqual(result, {
    outcome: "ambiguous",
    reason: "core_api_unavailable",
    status_code: null,
    core_effect: "unknown",
    activation: null,
  });
  assert.equal(requests, 1);
});

test("the ephemeral MCP session uses one browser authorization and Core requester", async () => {
  let configRequests = 0;
  let authorizations = 0;
  const coreRequests = [];
  const session = createEphemeralSequenceMcpSession({
    configUrl,
    fetch: async (input, init = {}) => {
      if (String(input) === configUrl) {
        configRequests += 1;
        return json(hostedConfig());
      }
      const url = new URL(String(input));
      coreRequests.push({
        method: init.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        authorization: init.headers.authorization,
      });
      return sequenceRoute({
        method: init.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        body: null,
        headers: init.headers,
      });
    },
    authorize: async () => {
      authorizations += 1;
      return bearer;
    },
  });
  const handlers = createSequenceToolHandlers(session);

  await handlers.list(scope);
  await handlers.read({ ...scope, sequence_id: sequenceId });
  await handlers.activate(activationInput());

  assert.equal(configRequests, 1);
  assert.equal(authorizations, 1);
  assert.deepEqual(coreRequests, [
    {
      method: "GET",
      path: "/v1/workspaces/northstar/sequences?environment=sandbox",
      authorization: `Bearer ${bearer}`,
    },
    {
      method: "GET",
      path: "/v1/workspaces/northstar/sequences/welcome-sequence?environment=sandbox",
      authorization: `Bearer ${bearer}`,
    },
    {
      method: "POST",
      path: "/v1/workspaces/northstar/sequences/welcome-sequence/activate?environment=sandbox",
      authorization: `Bearer ${bearer}`,
    },
  ]);
});

function draft(revision) {
  return {
    kind: "sequence_draft",
    outcome: null,
    sequence_id: sequenceId,
    revision,
    definition,
    plan: planResult(),
    created_at: "2026-09-19T08:00:00.000Z",
    updated_at: "2026-09-19T08:01:00.000Z",
  };
}

function planResult() {
  return {
    title: plan().title,
    entry: "subscription_episode",
    reentry: "once",
    steps: plan().steps.map((step) =>
      step.kind === "send"
        ? {
            step_id: step.stepId,
            kind: step.kind,
            content: step.content,
            subject: step.subject,
          }
        : {
            step_id: step.stepId,
            kind: step.kind,
            duration_seconds: step.durationSeconds,
          },
    ),
  };
}

function recordingClient(calls) {
  return {
    listSequences: async (input) => {
      calls.push(["list", input]);
      return { kind: "sequence_list", sequences: [draft(1)] };
    },
    readSequence: async (input) => {
      calls.push(["read", input]);
      return draft(1);
    },
    createSequence: async (input) => {
      calls.push(["create", input]);
      return { ...draft(1), outcome: "applied" };
    },
    updateSequence: async (input) => {
      calls.push(["update", input]);
      return { ...draft(2), outcome: "applied" };
    },
    validateSequence: async (input) => {
      calls.push(["validate", input]);
      return {
        kind: "sequence_validation",
        valid: true,
        definition,
        plan: planResult(),
      };
    },
    diffSequence: async (input) => {
      calls.push(["diff", input]);
      return {
        kind: "sequence_diff",
        sequence_id: sequenceId,
        base_revision: 1,
        current_revision: 2,
        diff: { changed: true },
      };
    },
    exportSequence: async (input) => {
      calls.push(["export", input]);
      return {
        kind: "sequence_export",
        sequence_id: sequenceId,
        revision: 2,
        definition,
      };
    },
    simulateSequence: async (input) => {
      calls.push(["simulate", input]);
      return {
        kind: "sequence_simulation",
        sequence_id: sequenceId,
        revision: 2,
        simulation: { enteredAtMs: 0, steps: [] },
        delivery: "not_requested_by_authoring_preview",
      };
    },
    activateSequence: async (input) => {
      calls.push(["activate", input]);
      return {
        kind: "sequence_activation",
        outcome: "activated",
        sequence_id: sequenceId,
        draft_revision: 2,
        activated_version: activationResult(),
      };
    },
  };
}

async function assertDraftTools(handlers) {
  const listed = await handlers.list(scope);
  assert.equal(listed.outcome, "completed");
  assert.equal(listed.sequences[0].sequence_id, sequenceId);
  assert.equal(
    (await handlers.read({ ...scope, sequence_id: sequenceId })).sequence
      .sequence_id,
    sequenceId,
  );
  assert.equal(
    (
      await handlers.create({
        ...scope,
        sequence_id: sequenceId,
        operation_key: "create-welcome",
        definition,
      })
    ).sequence.outcome,
    "applied",
  );
  assert.equal(
    (
      await handlers.update({
        ...scope,
        sequence_id: sequenceId,
        expected_revision: 1,
        operation_key: "update-welcome",
        definition,
      })
    ).sequence.revision,
    2,
  );
}

async function assertInspectionTools(handlers) {
  assert.equal(
    (await handlers.validate({ ...scope, definition })).validation.valid,
    true,
  );
  assert.equal(
    (await handlers.diff({ ...scope, sequence_id: sequenceId, definition }))
      .diff.base_revision,
    1,
  );
  assert.equal(
    (await handlers.export({ ...scope, sequence_id: sequenceId })).export
      .revision,
    2,
  );
  assert.equal(
    (
      await handlers.simulate({
        ...scope,
        sequence_id: sequenceId,
        entered_at_ms: 0,
      })
    ).simulation.delivery,
    "not_requested_by_authoring_preview",
  );
}

async function assertActivationTool(handlers) {
  const result = await handlers.activate(activationInput());
  assert.equal(result.outcome, "completed");
  assert.equal(result.activation.outcome, "activated");
  assert.equal(result.activation.activated_version.version, 1);
}

function activationInput() {
  return {
    ...scope,
    sequence_id: sequenceId,
    expected_revision: 2,
    operation_key: "activate-welcome",
    binding: {
      sender_id: activationBinding().senderId,
      scope: { kind: "general_marketing" },
      message_render_references: activationBinding().messageRenderReferences.map(
        (reference) => ({
          step_id: reference.stepId,
          render_reference: reference.renderReference,
        }),
      ),
    },
  };
}

function activationResult() {
  const version = activatedVersion();
  return {
    activated_version_id: version.activatedVersionId,
    version: version.version,
    draft_revision: version.draftRevision,
    definition: version.definition,
    binding: {
      sender_id: version.binding.senderId,
      scope: { kind: "general_marketing" },
      message_render_references: version.binding.messageRenderReferences.map(
        (reference) => ({
          step_id: reference.stepId,
          render_reference: reference.renderReference,
        }),
      ),
    },
    activated_at: version.activatedAt,
    activated_at_ms: version.activatedAtMs,
    current: version.current,
  };
}

function assertCoreInputs(calls) {
  assert.deepEqual(calls, [
    ["list", scope],
    ["read", { ...scope, sequenceId }],
    [
      "create",
      {
        ...scope,
        sequenceId,
        operationKey: "create-welcome",
        definition,
      },
    ],
    [
      "update",
      {
        ...scope,
        sequenceId,
        expectedRevision: 1,
        operationKey: "update-welcome",
        definition,
      },
    ],
    ["validate", { ...scope, definition }],
    ["diff", { ...scope, sequenceId, baseRevision: null, definition }],
    ["export", { ...scope, sequenceId }],
    [
      "simulate",
      {
        ...scope,
        sequenceId,
        enteredAtMs: 0,
        assumedAcceptedAtMs: {},
      },
    ],
    [
      "activate",
      {
        ...scope,
        sequenceId,
        expectedRevision: 2,
        operationKey: "activate-welcome",
        binding: activationBinding(),
      },
    ],
  ]);
}
