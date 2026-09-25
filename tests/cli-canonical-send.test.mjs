import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalBroadcastClient } from "../packages/cli/dist/operator-broadcast-canonical-send.js";
import { withAmbiguousBroadcastRecovery } from "../packages/cli/dist/operator-broadcast-recovery.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import { parseOperatorArguments } from "../packages/cli/dist/operator-arguments.js";
import { runOperatorCommand } from "../packages/cli/dist/operator-run.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000740";
const requestId = "00000000-0000-4000-8000-000000000741";
const prepareRequestId = "00000000-0000-4000-8000-000000000749";
const planId = "00000000-0000-4000-8000-000000000742";
const broadcastId = "00000000-0000-4000-8000-000000000743";
const grantId = `commercial:grant:v1:sha256:${"a".repeat(64)}`;
const review = {
  preparation: { commandId: requestId, expectedDraftVersion: 5,
    audienceSnapshotId: "contact_prepared_audience:v2:synthetic",
    purposePolicyGeneration: "contacts_marketing_subscription.v1",
    activeSource: "composer", clickTrackingEnabled: true, engagementTrackingEnabled: true,
    deliveryRequirements: { geography: [], dataResidency: [], ipCommitment: "either",
      maximumDeliveryDelaySeconds: 3600, excludedProviderIdentities: [],
      encryption: "tls_required", loggingPolicy: "delivery_events_v1",
      promisedProviderRouteVersion: null, commercialPriceAssumptions: {
        priceVersion: "synthetic", currency: "USD", maximumUnitPriceMicros: "500" } } },
  timing: { notBefore: "2026-09-25T10:00:00.000Z", expiresAt: "2026-09-25T11:00:00.000Z" },
  sendPlanId: planId, broadcastId, recipientCount: 2048, commercialGrantId: grantId,
  acceptedCandidateDigest: `sha256:${"a".repeat(64)}`,
  acceptedReviewDigest: `sha256:${"b".repeat(64)}`,
};
const admission = { schema: "broadcast_send_operation", operationId: planId,
  workspaceId: "workspace-synthetic", environment: "production", draftId,
  draftVersion: 5, broadcastId, sendPlanId: planId, recipientCount: 2048,
  executionAuthorized: true, replayed: false };
const status = { ...admission, replayed: true, phase: "sending", accepted: 0,
  skipped: 0, failed: 0, unknown: 0, pending: 2048, controlGeneration: 0 };

test("Prepare is ready only for the exact rendered message artifact from the Send plan", async () => {
  let renderedHtml = "<p>Synthetic body</p>";
  let authorizedCount = 2048;
  let sendPosts = 0;
  const request = async (path, options) => {
    if (path.includes("/audience-preparation?") && path.includes("afterOrdinal=")) return {
      status: "ready", manifest: { manifest: { manifestId: "synthetic-manifest",
        manifestDigest: "sha256:synthetic-manifest", purposePolicyGeneration: "csv_marketing_local_baseline.v1",
        authorizedRecipientSendCount: authorizedCount } },
    };
    if (path.includes("/audience-preparation?")) return { status: "accepted", operation: {
      state: "ready", phase: "ready", populationCompatibility: { status: "compatible" },
      resultRoot: { rootId: review.preparation.audienceSnapshotId },
      resultManifest: { manifestId: "synthetic-manifest", manifestDigest: "sha256:synthetic-manifest" },
      resultPopulation: null,
    } };
    if (path.includes("/billing/payment-method?")) return { disclosure: {
      priceGeneration: "synthetic", currency: "USD", unitPriceMicros: "500",
    } };
    if (path.includes("/send-plan?") && options?.body) return {
      status: "prepared", plan: { commandId: requestId, draftVersion: 5, draftId,
        sendPlanId: planId, broadcastAuthorizationId: planId, broadcastId,
        counts: { authorized: 2048 },
        messageArtifact: { id: "synthetic-artifact", digest: "sha256:synthetic" } },
      message: { messageArtifact: { messageArtifactId: "synthetic-artifact",
        artifactDigest: "sha256:synthetic", renderContent: { subject: "Synthetic subject", html: renderedHtml } } },
      commercial: { status: "review_required", review: { commercialGrantId: grantId,
        reviewDigest: review.acceptedReviewDigest,
        candidate: { authorizationCandidateDigest: review.acceptedCandidateDigest } } },
    };
    if (path.includes("/send-intent?")) sendPosts += 1;
    throw new Error(`unexpected path ${path}`);
  };
  const client = createCanonicalBroadcastClient(request);
  const ready = await client.prepare({ workspace, draftId, revision: 5,
    activeSource: "composer", requestId, prepareRequestId,
    expectedPolicyGeneration: "csv_marketing_local_baseline.v1" });
  assert.equal(ready.status, "ready");
  assert.equal(ready.renderedArtifactId, "synthetic-artifact");
  assert.equal(ready.review.preparation.purposePolicyGeneration, "csv_marketing_local_baseline.v1");
  renderedHtml = "";
  await assert.rejects(client.prepare({ workspace, draftId, revision: 5,
    activeSource: "composer", requestId, prepareRequestId,
    expectedPolicyGeneration: "csv_marketing_local_baseline.v1" }), /broadcast_send_review_mismatch/u);
  authorizedCount = 0;
  await assert.rejects(client.prepare({ workspace, draftId, revision: 5,
    activeSource: "composer", requestId, prepareRequestId,
    expectedPolicyGeneration: "csv_marketing_local_baseline.v1" }), /broadcast_audience_no_authorized_recipients/u);
  assert.equal(sendPosts, 0);
});

test("old-policy READY artifact remains immutable while a distinct Prepare identity is accepted", async () => {
  let preparePosts = 0;
  let sendPosts = 0;
  const request = async (path, options) => {
    if (path.includes("/audience-preparation?") && options?.body) {
      preparePosts += 1;
      assert.equal(options.body.requestId, prepareRequestId);
      assert.equal(options.body.expectedDraftVersion, 5);
      assert.notEqual(options.body.requestId, requestId);
      return { status: "accepted", replayed: preparePosts > 1 };
    }
    if (path.includes("/audience-preparation?") && path.includes("afterOrdinal=")) return {
      status: "ready", manifest: { manifest: { manifestId: "old-manifest",
        manifestDigest: "sha256:old", purposePolicyGeneration: "contacts_marketing_subscription.v1",
        authorizedRecipientSendCount: 0 } },
    };
    if (path.includes("/audience-preparation?")) return { status: "accepted", operation: {
      state: "ready", phase: "ready", populationCompatibility: { status: "compatible" },
      resultRoot: { rootId: "contact_prepared_audience:v2:old" },
      resultManifest: { manifestId: "old-manifest", manifestDigest: "sha256:old" },
    } };
    if (path.includes("/send-intent?")) sendPosts += 1;
    throw new Error(`unexpected path ${path}`);
  };
  const client = createCanonicalBroadcastClient(request);
  const input = { workspace, draftId, revision: 5, activeSource: "composer", requestId,
    prepareRequestId, expectedPolicyGeneration: "csv_marketing_local_baseline.v1" };
  assert.equal((await client.prepare(input)).status, "preparing");
  assert.equal((await client.prepare(input)).status, "preparing");
  assert.equal(preparePosts, 2);
  assert.equal(sendPosts, 0);
});

for (const lostResponse of [false, true]) {
  test(`canonical Send posts once and reads exact operation (lost response: ${lostResponse})`, async () => {
    let posted = 0;
    let accepted = false;
    const calls = [];
    const request = async (path, options) => {
      calls.push({ path, body: options?.body ?? null });
      if (path.includes("/send-plan?")) return {
        status: "prepared", executablePrepared: true,
        plan: { sendPlanId: planId, broadcastId, draftVersion: 5 },
        commercial: { status: "grant_committed",
          result: { grant: { commercialGrantId: grantId } },
          review: { reviewDigest: review.acceptedReviewDigest } },
      };
      if (path.includes("/send-intent?") && !options?.body) return accepted
        ? { status: "accepted", operation: status } : { status: "absent" };
      if (path.includes("/send-intent?") && options?.body) {
        posted += 1;
        accepted = true;
        if (lostResponse) throw new CoreOperatorError("core_api_unavailable", null, "unknown");
        return { status: "accepted", operation: admission, replayed: false };
      }
      throw new Error(`unexpected path ${path}`);
    };
    const client = createCanonicalBroadcastClient(request);
    const result = await client.send({ workspace, draftId, requestId, review });
    assert.equal(posted, 1);
    assert.equal(result.operationId, planId);
    assert.equal(result.broadcastId, broadcastId);
    assert.equal(result.recipientCount, 2048);
    assert.equal(result.replayed, lostResponse);
    assert.deepEqual(calls.map(({ path, body }) => [path.split("?")[0].split("/").at(-1), body?.schema ?? null]),
      [["send-intent", null], ["send-plan", null], ["send-intent", "broadcast_send_intent"], ["send-intent", null]]);
  });
}

test("direct CLI accepts reviewed input and rejects unreviewed Send shape", () => {
  const input = { workspace, draft_id: draftId, expected_revision: 5,
    snapshot_sha256: "a".repeat(64), request_id: requestId, review };
  const parsed = parseOperatorArguments(["broadcast", "send", "--send-input", JSON.stringify(input), "--json"]);
  assert.equal(parsed.command.kind, "broadcast_canonical_send");
  assert.deepEqual(parsed.command.sendInput, input);
  assert.throws(() => parseOperatorArguments(["broadcast", "send", "--send-input",
    JSON.stringify({ ...input, review: undefined }), "--json"]));
});

test("normal CLI pause controls the exact canonical operation through Send intent", async () => {
  const commandId = "00000000-0000-4000-8000-000000000744";
  const parsed = parseOperatorArguments(["broadcast", "pause", "--workspace", workspace,
    "--environment", "production", "--draft-id", draftId, "--operation-id", planId,
    "--request-id", commandId, "--expected-generation", "0", "--json"]);
  assert.deepEqual(parsed.command, { kind: "broadcast_canonical_control", workspace, draftId,
    operationId: planId, requestId: commandId, expectedGeneration: 0, action: "pause" });
  let posts = 0;
  const request = async (path, options) => {
    assert.equal(path, `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}/send-intent${options?.body ? "/control" : ""}?environment=production`);
    if (!options?.body) return { status: "accepted", operation: status };
    posts += 1;
    assert.deepEqual(options.body, { commandId, expectedGeneration: 0, action: "pause" });
    assert.equal(options.lostResponseEffect, "unknown");
    return { status: "accepted", operation: { ...status, phase: "paused", controlGeneration: 1 } };
  };
  const result = await createCanonicalBroadcastClient(request).control(parsed.command);
  assert.equal(result.phase, "paused");
  assert.equal(result.controlGeneration, 1);
  assert.equal(posts, 1);
});

test("canonical pause refuses a different operation and never retries an ambiguous control", async () => {
  const input = { workspace, draftId, operationId: planId,
    requestId: "00000000-0000-4000-8000-000000000745", expectedGeneration: 0,
    action: "pause" };
  let posts = 0;
  const wrong = createCanonicalBroadcastClient(async () => ({ status: "accepted",
    operation: { ...status, operationId: "00000000-0000-4000-8000-000000000746",
      sendPlanId: "00000000-0000-4000-8000-000000000746" } }));
  await assert.rejects(wrong.control(input), /broadcast_send_operation_mismatch/u);
  const ambiguous = createCanonicalBroadcastClient(async (_path, options) => {
    if (!options?.body) return { status: "accepted", operation: status };
    posts += 1;
    throw new CoreOperatorError("core_api_unavailable", null, "unknown");
  });
  await assert.rejects(ambiguous.control(input), error =>
    error instanceof CoreOperatorError && error.coreEffect === "unknown");
  assert.equal(posts, 1);
  const receipt = withAmbiguousBroadcastRecovery({ kind: "broadcast_canonical_control",
    workspace, draftId }, { core_effect: "unknown" });
  assert.equal(receipt.next_action.command,
    `fonte broadcast send status --workspace ${workspace} --environment production --draft-id ${draftId} --json`);
  assert.equal(receipt.next_action.retry_mutation, false);
});

test("normal broadcast pause command reaches canonical Core control, not legacy authorization rows", async () => {
  const commandId = "00000000-0000-4000-8000-000000000747";
  const parsed = parseOperatorArguments(["broadcast", "pause", "--workspace", workspace,
    "--environment", "production", "--draft-id", draftId, "--operation-id", planId,
    "--request-id", commandId, "--expected-generation", "0", "--json"]);
  const requests = [];
  const receipt = await runOperatorCommand(parsed.command, {
    configUrl: "https://fonte.is/.well-known/fonte-cli.json",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "fonte.is") return json({
        schema: "fonte.cli.hosted_config.v1", authorizationServer: "https://auth.example.test",
        clientId: "synthetic-cli", coreApiBaseUrl: "https://core.example.test",
        redirectUri: "http://127.0.0.1:49671/callback", scopes: ["email"],
      });
      requests.push({ path: url.pathname, method: init.method });
      assert.equal(url.pathname, `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}`
        + `/send-intent${init.method === "POST" ? "/control" : ""}`);
      return json(init.method === "POST"
        ? { status: "accepted", operation: { ...status, phase: "paused", controlGeneration: 1 } }
        : { status: "accepted", operation: status });
    },
    authorize: async () => "synthetic-token",
    sleep: async () => {},
    readProviderEvidenceCandidateFile: async () => { throw new Error("unused"); },
    readProviderPlacementApplicationFile: async () => { throw new Error("unused"); },
  }, () => commandId);
  assert.equal(receipt.command, "broadcast_canonical_control");
  assert.equal(receipt.core_effect, "controlled", JSON.stringify(receipt));
  assert.equal(receipt.result.operation.phase, "paused");
  assert.deepEqual(requests.map(request => request.method), ["GET", "POST"]);
  assert.equal(requests.some(request => request.path.includes("marketing-broadcasts")), false);
});

function json(value) {
  return new Response(JSON.stringify(value), { status: 200,
    headers: { "content-type": "application/json" } });
}
