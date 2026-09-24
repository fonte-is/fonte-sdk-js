import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  registerMcpBroadcastPavedTools,
} from "../packages/cli/dist/mcp-broadcast-paved-registration.js";
import {
  broadcastPavedPreparationOutputSchema,
  broadcastPavedSendOutputSchema,
  prepareBroadcastPavedInputSchema,
} from "../packages/cli/dist/mcp-broadcast-paved-types.js";
import {
  createBroadcastPavedOperator,
} from "../packages/cli/dist/operator-broadcast-paved.js";
import { preflightRecipientExpression } from
  "../packages/cli/dist/operator-preflight-audience-json.js";
import { CoreOperatorError } from
  "../packages/cli/dist/operator-core-request.js";
import {
  BroadcastDiagnostics,
  withBroadcastDiagnostics,
} from "../packages/cli/dist/operator-broadcast-diagnostics.js";

const workspace = "workspace-synthetic";
const draftId = "00000000-0000-4000-8000-000000000740";
const senderId = "sender-synthetic";
const purposeId = "purpose-synthetic";

test("verbose Prepare identifies failed Core stages", async () => {
  const csvBytes = Buffer.from("email\nmember@example.test\n", "utf8");
  const cases = [
    {
      stage: "sender_catalog", reason: "oauth_client_route_denied", status: 403,
      setup() {
        const fakes = createFakes({ existingDraft: readyDraft() });
        fakes.dependencies.senders = async () => ({
          listBroadcastSenders: async () => {
            throw new CoreOperatorError("oauth_client_route_denied", 403, "none");
          },
        });
        return { dependencies: fakes.dependencies, input: { draft_id: draftId } };
      },
    },
    {
      stage: "audience_options", reason: "oauth_client_route_denied", status: 403,
      setup() {
        const fakes = createFakes({ existingDraft: readyDraft() });
        fakes.dependencies.productionDrafts = async () => ({
          listProductionAudienceOptions: async () => {
            throw new CoreOperatorError("oauth_client_route_denied", 403, "none");
          },
        });
        return { dependencies: fakes.dependencies, input: { draft_id: draftId } };
      },
    },
    {
      stage: "recipient_set_read", reason: "oauth_client_route_denied", status: 403,
      setup() {
        const recipientSetSupplier = {
          createBroadcastRecipientSet: async () => { throw new Error("unused"); },
          readBroadcastRecipientSet: async () => {
            throw new CoreOperatorError("oauth_client_route_denied", 403, "none");
          },
        };
        const fakes = createFakes({ existingDraft: readyDraft(), recipientSetSupplier,
          readFile: async (filePath) => ({ path: filePath, bytes: Buffer.from(csvBytes) }) });
        return { dependencies: fakes.dependencies,
          input: { draft_id: draftId, audience_file: "/private/tmp/synthetic-audience.csv" } };
      },
    },
    {
      stage: "recipient_set_create", reason: "broadcast_recipient_set_create_denied", status: 400,
      setup() {
        const recipientSetSupplier = {
          createBroadcastRecipientSet: async () => {
            throw new CoreOperatorError("broadcast_recipient_set_create_denied", 400, "none");
          },
          readBroadcastRecipientSet: async () => {
            throw new CoreOperatorError("broadcast_recipient_set_not_found", 404, "none");
          },
        };
        const fakes = createFakes({ existingDraft: readyDraft(), recipientSetSupplier,
          readFile: async (filePath) => ({ path: filePath, bytes: Buffer.from(csvBytes) }) });
        return { dependencies: fakes.dependencies,
          input: { draft_id: draftId, audience_file: "/private/tmp/synthetic-audience.csv" } };
      },
    },
    {
      stage: "targeting_bind", reason: "broadcast_targeting_conflict", status: 409,
      setup() {
        const draft = { ...readyDraft(), audience_kind: "recipient_expression",
          recipient_expression: { include: [], exclude: [] } };
        const fakes = createFakes({ existingDraft: draft });
        fakes.dependencies.targeting = async () => ({
          updateBroadcastTargeting: async () => {
            throw new CoreOperatorError("broadcast_targeting_conflict", 409, "none");
          },
        });
        return { dependencies: fakes.dependencies,
          input: { draft_id: draftId, audience_selector: "all_contacts" } };
      },
    },
    {
      stage: "render", reason: "broadcast_render_unavailable", status: 503,
      setup() {
        const fakes = createFakes({ existingDraft: readyDraft() });
        fakes.dependencies.render = async () => ({
          renderBroadcastDraft: async () => {
            throw new CoreOperatorError("broadcast_render_unavailable", 503, "none");
          },
        });
        return { dependencies: fakes.dependencies, input: { draft_id: draftId } };
      },
    },
  ];

  for (const scenario of cases) {
    const { dependencies, input } = scenario.setup();
    const diagnostics = new BroadcastDiagnostics("prepare");
    const operator = createBroadcastPavedOperator(dependencies);
    const result = await withBroadcastDiagnostics(diagnostics, () => operator.prepare(input));
    const output = diagnostics.output();
    assert.equal(result.status, "blocked", scenario.stage);
    assert.match(output, new RegExp(`prepare\\.${scenario.stage}\\s+\\d+ms`, "u"));
    assert.match(output, new RegExp(`${scenario.status} ${scenario.reason}`, "u"));
    assert.match(output, new RegExp(`prepare\\.failed_at ${scenario.stage}`, "u"));
  }
});

test("workspace selection returns exact choices instead of selecting a first match", async () => {
  const fakes = createFakes({ workspaces: [workspaceSummary(), {
    ...workspaceSummary(), slug: "workspace-second", name: "Second Workspace",
  }] });
  const operator = createBroadcastPavedOperator(fakes.dependencies);

  const result = await operator.prepare({ draft_id: draftId });

  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.missing, ["workspace_selector"]);
  assert.deepEqual(result.choices.map(({ value }) => value), [
    workspace,
    "workspace-second",
  ]);
  assert.equal(fakes.calls.draftReads, 0);
  assert.equal(broadcastPavedPreparationOutputSchema.safeParse(result).success, true);
});

test("saved selected workspace wins without prompting, while an explicit selector can switch", async () => {
  const secondWorkspace = {
    ...workspaceSummary(),
    slug: "workspace-second",
    name: "Second Workspace",
  };
  const fakes = createFakes({
    workspaces: [workspaceSummary(), secondWorkspace],
    selectedWorkspace: secondWorkspace.slug,
    existingDraft: readyDraft(),
  });
  const operator = createBroadcastPavedOperator(fakes.dependencies);

  const selected = await operator.prepare({ draft_id: draftId });
  const switched = await operator.prepare({
    draft_id: draftId,
    workspace_selector: workspace,
  });

  assert.equal(selected.status, "ready_to_send");
  assert.equal(fakes.calls.readDraftWorkspaces[0], secondWorkspace.slug);
  assert.equal(switched.status, "ready_to_send");
  assert.equal(fakes.calls.readDraftWorkspaces.at(-1), workspace);
  assert.equal(fakes.calls.revisions, 0);
});

test("create and repeated preparation retain one exact draft and never Test Send", async () => {
  const fakes = createFakes();
  const operator = createBroadcastPavedOperator(fakes.dependencies);
  const input = {
    workspace_selector: workspace,
    environment: "production",
    create_new: true,
    title: "Synthetic launch",
    subject: "A useful update",
    text_source: "Synthetic body",
    sender_selector: "Sender Synthetic <sender@example.test>",
    audience_selector: "all_contacts",
    communication_purpose_selector: "Marketing",
  };

  const first = await operator.prepare(input);
  const second = await operator.prepare(input);

  assert.equal(first.status, "ready_to_send");
  assert.equal(second.status, "ready_to_send");
  assert.equal(first.draft_id, second.draft_id);
  assert.deepEqual(first.send_input, second.send_input);
  assert.equal(fakes.calls.creates, 1);
  assert.deepEqual(fakes.calls.createdAudiences, [{
    kind: "all_contacts",
    expression: null,
  }]);
  assert.equal(fakes.calls.sends, 0);
  assert.equal(fakes.calls.tests, 0);
  assert.equal(broadcastPavedPreparationOutputSchema.safeParse(first).success, true);
});

test("ambiguous sender choices stay unresolved and do not create a draft", async () => {
  const fakes = createFakes({ senders: [
    senderProfile("sender-one", "Shared Name", "one@example.test"),
    senderProfile("sender-two", "Shared Name", "two@example.test"),
  ] });
  const operator = createBroadcastPavedOperator(fakes.dependencies);

  const result = await operator.prepare({
    workspace_selector: workspace,
    environment: "production",
    create_new: true,
    title: "Synthetic launch",
    subject: "A useful update",
    text_source: "Synthetic body",
  });

  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.missing, ["sender_selector"]);
  assert.deepEqual(result.choices.map(({ value }) => value), [
    "Shared Name <one@example.test>",
    "Shared Name <two@example.test>",
  ]);
  assert.equal(fakes.calls.creates, 0);
});

test("CSV preparation resumes the same durable set after pending and binds only that set", async () => {
  const csvBytes = Buffer.from("email\nmember@example.test\n", "utf8");
  const sourceSha256 = createHash("sha256").update(csvBytes).digest("hex");
  const supplierCalls = [];
  const supplierReadSetIds = [];
  let created = false;
  let postCreateReads = 0;
  const recipientSetSupplier = {
    async createBroadcastRecipientSet(input) {
      supplierCalls.push(input);
      created = true;
      return {
        recipient_set: {
          kind: "broadcast_recipient_set",
          one_time_set_id: input.setId,
          draft_id: input.draftId,
          status: "pending",
          operation_status: "pending",
          contact_import_batch_id: "00000000-0000-4000-8000-000000000750",
          created_at: "2026-09-24T10:00:00.000Z",
          population_effect: "broadcast_only_not_everyone",
        },
        source: {
          file_name: "synthetic-audience.csv",
          sha256: sourceSha256,
          byte_length: csvBytes.byteLength,
          row_count: 1,
        },
      };
    },
    async readBroadcastRecipientSet(input) {
      supplierReadSetIds.push(input.setId);
      if (!created) {
        throw new CoreOperatorError("broadcast_recipient_set_not_found", 404, "none");
      }
      postCreateReads += 1;
      const status = postCreateReads >= 4 ? "completed" : "pending";
      return {
        kind: "broadcast_recipient_set",
        one_time_set_id: input.setId,
        draft_id: input.draftId,
        status,
        operation_status: status,
        contact_import_batch_id: "00000000-0000-4000-8000-000000000750",
        created_at: "2026-09-24T10:00:00.000Z",
        population_effect: "broadcast_only_not_everyone",
      };
    },
  };
  const fakes = createFakes({
    recipientSetSupplier,
    readFile: async (filePath) => ({ path: filePath, bytes: Buffer.from(csvBytes) }),
  });
  const input = {
    create_new: true,
    title: "Synthetic launch",
    subject: "A useful update",
    text_source: "Synthetic body",
    audience_file: "/private/tmp/synthetic-audience.csv",
  };
  let processA = createBroadcastPavedOperator(fakes.dependencies);

  const pending = await processA.prepare(input);
  const draftWhilePending = structuredClone(fakes.draft);
  processA = null;
  const processB = createBroadcastPavedOperator(fakes.dependencies);
  const ready = await processB.prepare(input);

  assert.equal(pending.status, "preparing");
  assert.deepEqual(pending.missing, []);
  assert.deepEqual(pending.choices, []);
  assert.equal(pending.send_input, null);
  assert.equal(draftWhilePending.audience_kind, "recipient_expression");
  assert.deepEqual(draftWhilePending.recipient_expression, {
    include: [],
    exclude: [],
  });
  assert.throws(
    () => preflightRecipientExpression(draftWhilePending.recipient_expression),
    /core_operator_receipt_invalid/u,
  );
  assert.equal(draftWhilePending.recipient_selection, null);
  assert.equal(fakes.calls.createdDrafts.length, 1);
  assert.notEqual(fakes.calls.createdDrafts[0].audience_kind, "all_contacts");
  assert.deepEqual(fakes.calls.createdAudiences, [{
    kind: "recipient_expression",
    expression: { include: [], exclude: [] },
  }]);
  assert.doesNotMatch(JSON.stringify(pending), /oneTimeSetId|clientRequestKey|synthetic-audience\.csv/u);
  assert.equal(ready.status, "ready_to_send");
  assert.equal(supplierCalls.length, 1);
  assert.equal(supplierCalls[0].csvFilePath, input.audience_file);
  assert.equal(supplierCalls[0].expectedDraftVersion, 1);
  assert.equal(supplierCalls[0].setId, deterministicUuid(
    "broadcast-paved-csv-set-v1",
    { workspace, draftId: ready.draft_id, sourceSha256 },
  ));
  assert.equal(supplierCalls[0].clientRequestKey, deterministicUuid(
    "broadcast-paved-csv-request-v1",
    { workspace, draftId: ready.draft_id, sourceSha256 },
  ));
  assert.ok(supplierReadSetIds.length >= 4);
  assert.ok(supplierReadSetIds.every((setId) => setId === supplierCalls[0].setId));
  assert.doesNotMatch(JSON.stringify(ready), /00000000-0000-4000-8000-000000000750/u);
  assert.deepEqual(fakes.draft.recipient_selection, {
    to: {
      kind: "selected",
      references: [{
        kind: "one_time",
        oneTimeSetId: supplierCalls[0].setId,
      }],
    },
    except: [],
  });
  assert.equal(fakes.draft.audience_kind, "recipient_expression");
  assert.equal(fakes.calls.targeting, 1);
  assert.deepEqual(fakes.calls.renderedRevisions, [2]);
  assert.equal(fakes.calls.sends, 0);
  assert.equal(fakes.calls.tests, 0);
  assert.equal(broadcastPavedPreparationOutputSchema.safeParse(pending).success, true);
  assert.equal(broadcastPavedPreparationOutputSchema.safeParse(ready).success, true);
});

test("existing draft selects its sole purpose, recovers lost PATCH ack, and resumes CSV idempotently", async () => {
  const csvBytes = Buffer.from("email\nmember@example.test\n", "utf8");
  const sourceSha256 = createHash("sha256").update(csvBytes).digest("hex");
  let setCreated = false;
  let setReads = 0;
  let setCreates = 0;
  const recipientSetSupplier = {
    async createBroadcastRecipientSet(input) {
      setCreates += 1;
      setCreated = true;
      return {
        recipient_set: {
          kind: "broadcast_recipient_set",
          one_time_set_id: input.setId,
          draft_id: input.draftId,
          status: "pending",
          operation_status: "pending",
          contact_import_batch_id: null,
          created_at: "2026-09-24T10:00:00.000Z",
          population_effect: "broadcast_only_not_everyone",
        },
        source: {
          file_name: "synthetic-audience.csv",
          sha256: sourceSha256,
          byte_length: csvBytes.byteLength,
          row_count: 1,
        },
      };
    },
    async readBroadcastRecipientSet(input) {
      if (!setCreated) {
        throw new CoreOperatorError("broadcast_recipient_set_not_found", 404, "none");
      }
      setReads += 1;
      const status = setReads >= 4 ? "completed" : "pending";
      return {
        kind: "broadcast_recipient_set",
        one_time_set_id: input.setId,
        draft_id: input.draftId,
        status,
        operation_status: status,
        contact_import_batch_id: null,
        created_at: "2026-09-24T10:00:00.000Z",
        population_effect: "broadcast_only_not_everyone",
      };
    },
  };
  const initialDraft = {
    ...readyDraft(),
    communication_purpose_id: null,
    communication_purpose_name: null,
  };
  const fakes = createFakes({
    existingDraft: initialDraft,
    recipientSetSupplier,
    readFile: async (filePath) => ({ path: filePath, bytes: Buffer.from(csvBytes) }),
  });
  let losePatchAcknowledgement = true;
  fakes.revisionBehavior = async (input) => {
    fakes.calls.revisions += 1;
    assert.deepEqual(input.changes, { communicationPurposeId: purposeId });
    assert.equal(input.draftId, draftId);
    assert.equal(input.baseRevision, 1);
    Object.assign(fakes.draft, applyChanges(fakes.draft, input.changes));
    fakes.draft.revision += 1;
    if (losePatchAcknowledgement) {
      losePatchAcknowledgement = false;
      throw new CoreOperatorError("core_api_unavailable", null, "unknown");
    }
    return lifecycleResult(fakes.draft);
  };
  const input = {
    draft_id: draftId,
    audience_file: "/private/tmp/synthetic-audience.csv",
  };
  const processA = createBroadcastPavedOperator(fakes.dependencies);

  const pending = await processA.prepare(input);
  assert.equal(pending.status, "preparing");
  assert.deepEqual(pending.missing, []);
  assert.deepEqual(pending.choices, []);
  assert.equal(fakes.draft.draft_id, draftId);
  assert.equal(fakes.draft.communication_purpose_id, purposeId);
  assert.equal(fakes.calls.creates, 0);
  assert.equal(fakes.calls.createdDrafts.length, 0);
  assert.equal(fakes.calls.revisions, 1);
  assert.equal(setCreates, 1);

  const processB = createBroadcastPavedOperator(fakes.dependencies);
  const ready = await processB.prepare(input);
  const repeated = await processB.prepare(input);

  assert.equal(ready.status, "ready_to_send");
  assert.equal(ready.draft_id, draftId);
  assert.equal(ready.revision, 3);
  assert.equal(fakes.draft.communication_purpose_id, purposeId);
  assert.deepEqual(repeated.send_input, ready.send_input);
  assert.equal(fakes.calls.creates, 0);
  assert.equal(fakes.calls.createdDrafts.length, 0);
  assert.equal(fakes.calls.revisions, 1);
  assert.equal(setCreates, 1);
  assert.equal(fakes.calls.targeting, 1);
  assert.equal(fakes.calls.sends, 0);
  assert.equal(fakes.calls.tests, 0);
});

test("exact supplied purpose revises the same draft and multiple purposes stay a product choice", async () => {
  const alternativePurpose = {
    communication_purpose_id: "purpose_synthetic_alternative",
    label: "Synthetic announcements",
  };
  const fakes = createFakes({
    existingDraft: { ...readyDraft(), communication_purpose_id: null },
    purposes: [
      { communication_purpose_id: purposeId, label: "Marketing" },
      alternativePurpose,
    ],
  });
  const operator = createBroadcastPavedOperator(fakes.dependencies);

  const choices = await operator.prepare({ draft_id: draftId });
  assert.equal(choices.status, "needs_input");
  assert.deepEqual(choices.missing, ["communication_purpose_selector"]);
  assert.deepEqual(choices.choices.map(({ value }) => value), [
    "Marketing",
    "Synthetic announcements",
  ]);
  assert.equal(fakes.calls.revisions, 0);

  const selected = await operator.prepare({
    draft_id: draftId,
    communication_purpose_selector: alternativePurpose.label,
  });
  assert.equal(selected.status, "ready_to_send");
  assert.equal(selected.draft_id, draftId);
  assert.equal(fakes.draft.communication_purpose_id, alternativePurpose.communication_purpose_id);
  assert.equal(fakes.calls.revisions, 1);
  assert.equal(fakes.calls.creates, 0);
  assert.equal(fakes.calls.sends, 0);
});

test("lost revision acknowledgement is recovered by exact readback without a duplicate mutation", async () => {
  const fakes = createFakes({ existingDraft: readyDraft() });
  let loseFirstAcknowledgement = true;
  fakes.revisionBehavior = async ({ changes }) => {
    fakes.calls.revisions += 1;
    Object.assign(fakes.draft, applyChanges(fakes.draft, changes));
    fakes.draft.revision += 1;
    if (loseFirstAcknowledgement) {
      loseFirstAcknowledgement = false;
      throw new CoreOperatorError("core_api_unavailable", null, "unknown");
    }
    return lifecycleResult(fakes.draft);
  };
  const operator = createBroadcastPavedOperator(fakes.dependencies);

  const result = await operator.prepare({
    workspace_selector: workspace,
    environment: "production",
    draft_id: draftId,
    text_source: "Revised body",
  });

  assert.equal(result.status, "ready_to_send");
  assert.equal(fakes.draft.revision, 2);
  assert.equal(fakes.calls.revisions, 1);
  assert.equal(fakes.calls.sends, 0);
  assert.equal(fakes.calls.tests, 0);
});

test("Send fails closed when the prepared revision drifts", async () => {
  const fakes = createFakes({ existingDraft: readyDraft() });
  const operator = createBroadcastPavedOperator(fakes.dependencies);
  const prepared = await operator.prepare({
    workspace_selector: workspace,
    environment: "production",
    draft_id: draftId,
  });
  assert.equal(prepared.status, "ready_to_send");

  fakes.draft.revision += 1;
  fakes.draft.subject = "Changed after preparation";
  const receipt = await operator.send(prepared.send_input);

  assert.equal(receipt.outcome, "blocked");
  assert.equal(receipt.reason, "prepared_draft_state_changed");
  assert.equal(fakes.calls.sendReads, 0);
  assert.equal(fakes.calls.sends, 0);
  const sendValidation = broadcastPavedSendOutputSchema.safeParse(receipt);
  assert.equal(sendValidation.success, true,
    JSON.stringify(sendValidation.success ? [] : sendValidation.error.issues));
});

test("prepare in process A, exit it, and Send unchanged facts in fresh process B", async () => {
  const preparedByA = runFreshOperatorProcess("prepare", {
    workspace,
    draft: readyDraft(),
  });
  assert.equal(preparedByA.result.status, "ready_to_send");
  const unchangedSendInput = preparedByA.result.send_input;
  const sentByB = runFreshOperatorProcess("send", {
    workspace,
    draft: preparedByA.draft,
    sendInput: unchangedSendInput,
    sendResult: acceptedResult(false),
  });

  assert.equal(sentByB.receipt.outcome, "queued");
  assert.deepEqual(sentByB.acceptedRequests, [{
    workspace,
    draftId,
    requestId: unchangedSendInput.request_id,
    expectedDraftVersion: preparedByA.result.revision,
    timing: { mode: "now" },
  }]);
  assert.equal(broadcastPavedSendOutputSchema.safeParse(sentByB.receipt).success, true);
});

test("Send uses one durable v3 request identity through lost-response recovery", async () => {
  const fakes = createFakes({ existingDraft: readyDraft() });
  const operator = createBroadcastPavedOperator(fakes.dependencies);
  const prepared = await operator.prepare({
    workspace_selector: workspace,
    environment: "production",
    draft_id: draftId,
  });
  assert.equal(prepared.status, "ready_to_send");
  fakes.loseFirstSendAcknowledgement = true;

  const receipt = await operator.send(prepared.send_input);
  const repeated = await operator.send(prepared.send_input);

  assert.equal(receipt.outcome, "queued");
  assert.equal(receipt.result.operation.operation_id,
    "00000000-0000-4000-8000-000000000743");
  assert.notEqual(receipt.result.operation.operation_id,
    fakes.acceptedRequests[0].requestId);
  assert.equal(fakes.acceptedRequests.length, 3);
  assert.equal(fakes.acceptedRequests[0].requestId,
    fakes.acceptedRequests[1].requestId);
  assert.equal(fakes.acceptedRequests[1].requestId,
    fakes.acceptedRequests[2].requestId);
  assert.equal(fakes.acceptedRequests[0].expectedDraftVersion, 1);
  assert.deepEqual(fakes.acceptedRequests[0].timing, { mode: "now" });
  assert.equal(fakes.calls.sendReads, 1);
  assert.equal(fakes.calls.durableSends, 1);
  assert.notEqual(repeated, receipt);
  assert.equal(repeated.outcome, "queued");
  const sendValidation = broadcastPavedSendOutputSchema.safeParse(receipt);
  assert.equal(sendValidation.success, true,
    JSON.stringify(sendValidation.success ? [] : sendValidation.error.issues));
});

test("MCP registration exports only the two FON-740 tools with strict inputs", async () => {
  const fakes = createFakes({ existingDraft: readyDraft() });
  const operator = createBroadcastPavedOperator(fakes.dependencies);
  const registrations = [];
  registerMcpBroadcastPavedTools({
    registerTool: (...args) => registrations.push(args),
  }, operator);

  assert.deepEqual(registrations.map(([name]) => name), [
    "fonte_prepare_broadcast",
    "fonte_send_broadcast",
  ]);
  assert.equal(registrations[0][1].annotations.destructiveHint, false);
  assert.equal(registrations[1][1].annotations.destructiveHint, true);
  assert.equal(prepareBroadcastPavedInputSchema.safeParse({
    draft_id: draftId,
    workspace_selector: workspace,
    sender_profile_id: senderId,
  }).success, false);
  assert.equal(prepareBroadcastPavedInputSchema.safeParse({
    draft_id: draftId,
    html_source_file: "/tmp/source.html",
    text_source: null,
  }).success, true);
  assert.equal(prepareBroadcastPavedInputSchema.safeParse({
    create_new: true,
    title: "Synthetic launch",
    subject: "A useful update",
    text_source: "Synthetic body",
    audience_file: "/private/tmp/audience.csv",
  }).success, true);
  assert.equal(prepareBroadcastPavedInputSchema.safeParse({
    draft_id: draftId,
    audience_file: "/private/tmp/audience.csv",
    audience_selector: "all_contacts",
  }).success, false);
  const response = await registrations[0][2]({
    draft_id: draftId,
    workspace_selector: workspace,
    environment: "production",
  });
  assert.equal(response.structuredContent.status, "ready_to_send");
  assert.equal(response.content[0].text,
    JSON.stringify(response.structuredContent));
});

function runFreshOperatorProcess(mode, payload) {
  const operatorModule = new URL(
    "../packages/cli/dist/operator-broadcast-paved.js",
    import.meta.url,
  ).href;
  const script = `
    import { readFileSync } from "node:fs";
    import { createBroadcastPavedOperator } from ${JSON.stringify(operatorModule)};

    const input = JSON.parse(readFileSync(0, "utf8"));
    const acceptedRequests = [];
    const draft = input.draft;
    const lifecycle = {
      kind: "broadcast_draft",
      outcome: null,
      draft_id: draft.draft_id,
      revision: draft.revision,
      draft,
    };
    const dependencies = {
      workspaceCatalog: async () => ({
        listWorkspaces: async () => [{
          slug: input.workspace,
          name: "Synthetic Workspace",
          role: "operator",
          available_environments: ["production"],
        }],
      }),
      draftLifecycle: async () => ({
        readBroadcastDraft: async () => lifecycle,
      }),
      senders: async () => ({
        listBroadcastSenders: async () => ({
          kind: "broadcast_sender_catalog",
          sender_profiles: [{
            sender_profile_id: draft.sender_profile_id,
            name: "Sender Synthetic",
            email: "sender@example.test",
            default_reply_to: "sender@example.test",
          }],
          resolution: {
            outcome: "unique",
            sender_profile_id: draft.sender_profile_id,
            candidate_sender_profile_ids: [draft.sender_profile_id],
          },
        }),
      }),
      productionDrafts: async () => ({
        listProductionAudienceOptions: async () => ({
          kind: "broadcast_audience_options",
          communication_purposes: [{
            communication_purpose_id: draft.communication_purpose_id,
            label: "Marketing",
          }],
          sources: [],
        }),
      }),
      render: async () => ({
        renderBroadcastDraft: async ({ draftId, revision }) => ({
          draft_id: draftId,
          revision,
        }),
      }),
      send: async () => ({
        readBroadcastSendOperation: async () => ({
          kind: "broadcast_send_operation",
          status: "absent",
          operation: null,
        }),
        acceptBroadcastSend: async (request) => {
          acceptedRequests.push(request);
          return input.sendResult;
        },
      }),
      readFile: async () => { throw new Error("unused file input"); },
    };
    const operator = createBroadcastPavedOperator(dependencies);
    const result = input.mode === "prepare"
      ? await operator.prepare({
          workspace_selector: input.workspace,
          environment: "production",
          draft_id: draft.draft_id,
        })
      : await operator.send(input.sendInput);
    process.stdout.write(JSON.stringify({
      result: input.mode === "prepare" ? result : undefined,
      receipt: input.mode === "send" ? result : undefined,
      draft,
      acceptedRequests,
    }));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { input: JSON.stringify({ mode, ...payload }), encoding: "utf8" },
  ));
}

function createFakes({
  workspaces = [workspaceSummary()],
  senders = [senderProfile(senderId, "Sender Synthetic", "sender@example.test")],
  existingDraft = null,
  selectedWorkspace = null,
  recipientSetSupplier = null,
  readFile = async () => { throw new Error("no file source expected"); },
  purposes = [{ communication_purpose_id: purposeId, label: "Marketing" }],
} = {}) {
  const calls = {
    creates: 0,
    draftReads: 0,
    revisions: 0,
    sends: 0,
    sendReads: 0,
    renders: 0,
    tests: 0,
    durableSends: 0,
    targeting: 0,
    createdAudiences: [],
    createdDrafts: [],
    readDraftWorkspaces: [],
    renderedRevisions: [],
  };
  const acceptedRequests = [];
  const durableSends = new Map();
  const fakes = {
    calls,
    acceptedRequests,
    draft: existingDraft ? { ...existingDraft } : null,
    loseFirstSendAcknowledgement: false,
    revisionBehavior: null,
    recipientSetSupplier: async () => recipientSetSupplier,
    dependencies: null,
  };
  const lifecycle = {
    async readBroadcastDraft({ draftId: requestedId, workspace: requestedWorkspace }) {
      calls.draftReads += 1;
      calls.readDraftWorkspaces.push(requestedWorkspace);
      if (!fakes.draft || fakes.draft.draft_id !== requestedId) {
        throw new CoreOperatorError("broadcast_draft_not_found", 404, "none");
      }
      return lifecycleResult(fakes.draft);
    },
  };
  const productionDrafts = {
    async listProductionAudienceOptions() {
      return {
        kind: "broadcast_audience_options",
        communication_purposes: purposes,
        sources: [],
      };
    },
    async createProductionDraft(input) {
      calls.creates += 1;
      calls.createdAudiences.push(structuredClone(input.audience));
      fakes.draft = {
        ...blankDraft(input.idempotencyKey),
        title: input.title,
        sender_profile_id: input.senderProfileId,
        audience_kind: input.audience.kind,
        recipient_expression: input.audience.kind === "recipient_expression"
          ? structuredClone(input.audience.expression)
          : null,
        communication_purpose_id: input.communicationPurposeId,
        subject: input.subject,
        preheader: input.preheader,
        text_body: input.body,
        composer_body: input.body,
      };
      calls.createdDrafts.push(structuredClone(fakes.draft));
      return lifecycleResult(fakes.draft);
    },
  };
  fakes.dependencies = {
    workspaceCatalog: async () => ({ listWorkspaces: async () => workspaces }),
    readSelectedWorkspace: async () => selectedWorkspace,
    draftLifecycle: async () => lifecycle,
    draftRevision: async () => ({
      reviseBroadcastDraft: async (input) => {
        if (fakes.revisionBehavior) return fakes.revisionBehavior(input);
        calls.revisions += 1;
        fakes.draft = applyChanges(fakes.draft, input.changes);
        fakes.draft.revision += 1;
        return lifecycleResult(fakes.draft);
      },
    }),
    senders: async () => ({
      listBroadcastSenders: async () => ({
        kind: "broadcast_sender_catalog",
        sender_profiles: senders,
        resolution: { outcome: "ambiguous", sender_profile_id: null,
          candidate_sender_profile_ids: senders.map((sender) => sender.sender_profile_id) },
      }),
      updateBroadcastSender: async () => { throw new Error("unused sender update"); },
    }),
    targeting: async () => ({
      updateBroadcastTargeting: async (input) => {
        calls.targeting += 1;
        const baseRevision = fakes.draft.revision;
        Object.assign(fakes.draft, {
          audience_kind: "recipient_expression",
          audience_contact_import_batch_id: null,
          recipient_expression: null,
          recipient_selection: input.recipientSelection,
          revision: baseRevision + 1,
        });
        const result = lifecycleResult(fakes.draft);
        return {
          kind: "broadcast_targeting_revision",
          draft_id: result.draft_id,
          base_revision: baseRevision,
          revision: result.revision,
          operation_id: input.operationId,
          saved_at: fakes.draft.updated_at,
          recipient_selection: input.recipientSelection,
          draft: result.draft,
        };
      },
    }),
    productionDrafts: async () => productionDrafts,
    render: async () => ({
      renderBroadcastDraft: async ({ draftId: renderedDraftId, revision }) => {
        calls.renders += 1;
        calls.renderedRevisions.push(revision);
        return { draft_id: renderedDraftId, revision };
      },
      requestBroadcastTest: async () => { calls.tests += 1; throw new Error("forbidden test send"); },
      readBroadcastTest: async () => { calls.tests += 1; throw new Error("forbidden test read"); },
    }),
    send: async () => ({
      readBroadcastSendOperation: async () => {
        calls.sendReads += 1;
        return durableSends.size > 0
          ? acceptedResult(true)
          : { kind: "broadcast_send_operation", status: "absent", operation: null };
      },
      acceptBroadcastSend: async (input) => {
        calls.sends += 1;
        acceptedRequests.push(input);
        if (durableSends.has(input.requestId)) return acceptedResult(true);
        calls.durableSends += 1;
        durableSends.set(input.requestId, acceptedResult(false));
        if (fakes.loseFirstSendAcknowledgement && calls.sends === 1) {
          throw new CoreOperatorError("core_api_unavailable", null, "unknown");
        }
        return acceptedResult(calls.sends > 1);
      },
    }),
    readFile,
    recipientSetSupplier: async () => recipientSetSupplier,
  };
  return fakes;
}

function workspaceSummary() {
  return {
    slug: workspace,
    name: "Synthetic Workspace",
    role: "operator",
    available_environments: ["production"],
  };
}

function senderProfile(id, name, email) {
  return {
    sender_profile_id: id,
    name,
    email,
    default_reply_to: email,
  };
}

function blankDraft(id) {
  return {
    draft_id: id,
    revision: 1,
    source_campaign_id: null,
    source_broadcast_id: null,
    title: "Synthetic draft",
    sender_profile_id: senderId,
    reply_to: null,
    audience_kind: "all_contacts",
    audience_contact_import_batch_id: null,
    recipient_expression: null,
    recipient_selection: null,
    communication_purpose_id: purposeId,
    communication_purpose_name: "Marketing",
    subject: "Synthetic subject",
    preheader: null,
    text_body: "Synthetic body",
    active_source: "composer",
    composer_body: "Synthetic body",
    html_body: null,
    created_at: "2026-09-23T10:00:00.000Z",
    updated_at: "2026-09-23T10:00:00.000Z",
  };
}

function readyDraft() {
  return blankDraft(draftId);
}

function lifecycleResult(draft) {
  return {
    kind: "broadcast_draft",
    outcome: null,
    draft_id: draft.draft_id,
    revision: draft.revision,
    draft: { ...draft },
  };
}

function applyChanges(draft, changes) {
  const next = { ...draft };
  if (Object.hasOwn(changes, "title")) next.title = changes.title;
  if (Object.hasOwn(changes, "subject")) next.subject = changes.subject;
  if (Object.hasOwn(changes, "preheader")) next.preheader = changes.preheader;
  if (Object.hasOwn(changes, "composerBody")) {
    next.composer_body = changes.composerBody;
    next.text_body = changes.composerBody;
    next.active_source = "composer";
  }
  if (Object.hasOwn(changes, "htmlBody")) {
    next.html_body = changes.htmlBody;
    next.text_body = changes.htmlBody;
    next.active_source = "html";
  }
  if (Object.hasOwn(changes, "sender")) next.sender_profile_id = changes.sender;
  if (Object.hasOwn(changes, "communicationPurposeId")) {
    next.communication_purpose_id = changes.communicationPurposeId;
    next.communication_purpose_name = changes.communicationPurposeId === purposeId
      ? "Marketing"
      : "Synthetic announcements";
  }
  return next;
}

function acceptedResult(replayed) {
  return {
    kind: "broadcast_send_operation",
    status: "accepted",
    operation: {
      schema: "broadcast_send_operation.v2",
      operation_id: "00000000-0000-4000-8000-000000000743",
      workspace_id: "workspace-internal-synthetic",
      environment: "production",
      draft_id: draftId,
      instruction_generation: 1,
      approval_generation: 1,
      accepted_at: "2026-09-23T10:00:00.000Z",
      timing: { mode: "now" },
      not_before: "2026-09-23T10:00:00.000Z",
      phase: "queued",
      reason: null,
      retryable: true,
      next_attempt_at: "2026-09-23T10:00:01.000Z",
      total: null,
      timestamps: {
        preparation_started_at: null,
        snapshot_at: null,
        authorization_committed_at: null,
        first_submission_at: null,
        terminal_at: null,
      },
      delivery: {
        status: "unavailable",
        reason: "provider_submission_not_started",
        observed_at: null,
      },
      required_action: null,
      allowed_actions: ["cancel"],
      execution_authorized: false,
      replayed,
    },
  };
}

function deterministicUuid(scope, value) {
  const bytes = createHash("sha256")
    .update(scope)
    .update("\0")
    .update(stableJson(value))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
