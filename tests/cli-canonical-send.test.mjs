import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalBroadcastClient } from "../packages/cli/dist/operator-broadcast-canonical-send.js";
import { CoreOperatorError } from "../packages/cli/dist/operator-core-request.js";
import { parseOperatorArguments } from "../packages/cli/dist/operator-arguments.js";

const workspace = "northstar";
const draftId = "00000000-0000-4000-8000-000000000740";
const requestId = "00000000-0000-4000-8000-000000000741";
const planId = "00000000-0000-4000-8000-000000000742";
const broadcastId = "00000000-0000-4000-8000-000000000743";
const grantId = "00000000-0000-4000-8000-000000000744";
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
  skipped: 0, failed: 0, unknown: 0, pending: 2048 };

test("Prepare is ready only for the exact rendered message artifact from the Send plan", async () => {
  let renderedHtml = "<p>Synthetic body</p>";
  let sendPosts = 0;
  const request = async (path, options) => {
    if (path.includes("/audience-preparation?")) return { status: "accepted", operation: {
      state: "ready", phase: "ready", populationCompatibility: { status: "compatible" },
      resultRoot: { rootId: review.preparation.audienceSnapshotId },
      resultManifest: { id: "synthetic-manifest" }, resultPopulation: null,
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
    activeSource: "composer", requestId });
  assert.equal(ready.status, "ready");
  assert.equal(ready.renderedArtifactId, "synthetic-artifact");
  renderedHtml = "";
  await assert.rejects(client.prepare({ workspace, draftId, revision: 5,
    activeSource: "composer", requestId }), /broadcast_send_review_mismatch/u);
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
