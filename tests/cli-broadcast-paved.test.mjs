import assert from "node:assert/strict";
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
import { CoreOperatorError } from
  "../packages/cli/dist/operator-core-request.js";

const workspace = "workspace-synthetic";
const draftId = "00000000-0000-4000-8000-000000000740";
const senderId = "sender-synthetic";
const purposeId = "purpose-synthetic";

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
  const unavailable = await operator.send({
    preparation_reference: "bpr1_00000000-0000-4000-8000-000000000742",
  });
  assert.equal(unavailable.reason, "preparation_reference_unavailable");
  assert.equal(fakes.calls.sends, 0);
  assert.equal(broadcastPavedPreparationOutputSchema.safeParse(result).success, true);
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
  assert.equal(first.send_input.preparation_reference,
    second.send_input.preparation_reference);
  assert.equal(fakes.calls.creates, 1);
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

test("exact prepared state accepts one ordinary v3 Send-now operation", async () => {
  const fakes = createFakes({ existingDraft: readyDraft() });
  const operator = createBroadcastPavedOperator(fakes.dependencies);
  const prepared = await operator.prepare({
    workspace_selector: workspace,
    environment: "production",
    draft_id: draftId,
  });
  assert.equal(prepared.status, "ready_to_send");

  const receipt = await operator.send(prepared.send_input);

  assert.equal(receipt.outcome, "queued");
  assert.equal(fakes.calls.sends, 1);
  assert.equal(fakes.acceptedRequests.length, 1);
  assert.equal(fakes.acceptedRequests[0].expectedDraftVersion, prepared.revision);
  assert.deepEqual(fakes.acceptedRequests[0].timing, { mode: "now" });
  assert.equal(fakes.calls.tests, 0);
});

test("Send uses one stable v3 request identity through lost-response recovery", async () => {
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
  assert.equal(fakes.acceptedRequests.length, 2);
  assert.equal(fakes.acceptedRequests[0].requestId,
    fakes.acceptedRequests[1].requestId);
  assert.equal(fakes.acceptedRequests[0].expectedDraftVersion, 1);
  assert.deepEqual(fakes.acceptedRequests[0].timing, { mode: "now" });
  assert.equal(fakes.calls.sendReads, 2);
  assert.equal(repeated, receipt);
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
  const response = await registrations[0][2]({
    draft_id: draftId,
    workspace_selector: workspace,
    environment: "production",
  });
  assert.equal(response.structuredContent.status, "ready_to_send");
  assert.equal(response.content[0].text,
    JSON.stringify(response.structuredContent));
});

function createFakes({
  workspaces = [workspaceSummary()],
  senders = [senderProfile(senderId, "Sender Synthetic", "sender@example.test")],
  existingDraft = null,
} = {}) {
  const calls = {
    creates: 0,
    draftReads: 0,
    revisions: 0,
    sends: 0,
    sendReads: 0,
    renders: 0,
    tests: 0,
  };
  const acceptedRequests = [];
  const fakes = {
    calls,
    acceptedRequests,
    draft: existingDraft ? { ...existingDraft } : null,
    loseFirstSendAcknowledgement: false,
    revisionBehavior: null,
    dependencies: null,
  };
  const lifecycle = {
    async readBroadcastDraft({ draftId: requestedId }) {
      calls.draftReads += 1;
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
        communication_purposes: [{
          communication_purpose_id: purposeId,
          label: "Marketing",
        }],
        sources: [],
      };
    },
    async createProductionDraft(input) {
      calls.creates += 1;
      fakes.draft = {
        ...blankDraft(input.idempotencyKey),
        title: input.title,
        sender_profile_id: input.senderProfileId,
        audience_kind: input.audience.kind,
        communication_purpose_id: input.communicationPurposeId,
        subject: input.subject,
        preheader: input.preheader,
        text_body: input.body,
        composer_body: input.body,
      };
      return lifecycleResult(fakes.draft);
    },
  };
  fakes.dependencies = {
    workspaceCatalog: async () => ({ listWorkspaces: async () => workspaces }),
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
      updateBroadcastTargeting: async () => { throw new Error("unused audience update"); },
    }),
    productionDrafts: async () => productionDrafts,
    render: async () => ({
      renderBroadcastDraft: async ({ draftId: renderedDraftId, revision }) => {
        calls.renders += 1;
        return { draft_id: renderedDraftId, revision };
      },
      requestBroadcastTest: async () => { calls.tests += 1; throw new Error("forbidden test send"); },
      readBroadcastTest: async () => { calls.tests += 1; throw new Error("forbidden test read"); },
    }),
    send: async () => ({
      readBroadcastSendOperation: async () => {
        calls.sendReads += 1;
        return fakes.acceptedRequests.length > 0
          ? acceptedResult(true)
          : { kind: "broadcast_send_operation", status: "absent", operation: null };
      },
      acceptBroadcastSend: async (input) => {
        calls.sends += 1;
        acceptedRequests.push(input);
        if (fakes.loseFirstSendAcknowledgement && calls.sends === 1) {
          throw new CoreOperatorError("core_api_unavailable", null, "unknown");
        }
        return acceptedResult(calls.sends > 1);
      },
    }),
    readFile: async () => { throw new Error("no file source expected"); },
    randomUUID: () => "00000000-0000-4000-8000-000000000741",
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
