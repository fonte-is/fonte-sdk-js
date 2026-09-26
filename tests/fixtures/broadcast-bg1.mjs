/** Synthetic fixed FON-807 fixture projection from Core f9669b03:
 * test/fixtures/break-glass-conformance.ts. reviewDigest is actual Core helper output.
 * The client-facing workspace code intentionally differs from the immutable Core ID. */
export const coreOrigin = "https://core.example.test";
export const scope = {
  workspace: "bg1-fixture",
  environment: "sandbox",
  draftId: "draft_bg1",
};
export const workspaceId = "workspace_bg1_contract";
export const digest = `sha256:${"a".repeat(64)}`;
export const requestId = "00000000-0000-4000-8000-000000008071";
export const operationId = "00000000-0000-4000-8000-000000008072";
export const review = {
  workspaceId,
  environment: "sandbox",
  draftId: "draft_bg1",
  draftVersion: 1,
  audienceRef: {
    schema: "broadcast_audience.v1",
    audienceId: "audience_bg1",
    digest,
    recipientCount: 2048,
    selectionDigest: digest,
    purposeRef: "purpose_marketing",
  },
  messageRef: { id: "message_bg1", digest },
  routeRef: {
    schema: "broadcast_sender_route.v1",
    routeId: "route_bg1",
    digest,
    workspaceId,
    environment: "sandbox",
    provider: "ses_v2",
    accountId: "000000000000",
    region: "eu-west-1",
    senderIdentity: "example.test",
    authorizedFrom: "sender@example.test",
    tenantId: "tenant_bg1",
    configurationSet: "configuration_bg1",
    feedbackDestination: "feedback_bg1",
    setupSource: "portable",
    setupRevision: "configuration_revision_bg1",
  },
  commercialReviewRef: { id: "aggregate_review_fixture", digest },
  reviewId: "review_bg1",
  reviewDigest:
    "sha256:7e18783c88145f915c7fb7adbeef63289011d3cd82ebb05bba3ccdf396d268c8",
  createdAt: "2026-01-01T00:00:00.000Z",
};
export const sendRequest = {
  schema: "broadcast_send_request.v2",
  requestId,
  reviewId: review.reviewId,
  reviewDigest: review.reviewDigest,
  expectedDraftVersion: 1,
  timing: { mode: "now" },
};
export const reviewRequest = {
  schema: "broadcast_review_request.v1",
  requestId,
  expectedDraftVersion: 1,
  audienceMode: "reuse_compatible",
};
export const receiptBase = {
  operationId,
  operationVersion: 1,
  draftId: "draft_bg1",
  reviewId: "review_bg1",
  operationUri:
    "/v1/workspaces/workspace_bg1_contract/broadcast-send-operations/operation_bg1",
  observedAt: "2026-01-01T00:00:00.000Z",
};
export const ready = {
  ...receiptBase,
  state: "ready",
  executionAuthorized: false,
  review,
  summary: { recipientCount: 2048, excludedCount: 0 },
};
export const zeroReady = {
  ...ready,
  review: {
    ...review,
    audienceRef: { ...review.audienceRef, recipientCount: 0 },
    reviewDigest:
      "sha256:1d62c88706745d85f1d1f1cd56870ca64b7fe5691a9f93ac6787b2817adf5d4d",
  },
  summary: { recipientCount: 0, excludedCount: 0 },
};
export const processing = {
  ...receiptBase,
  outcome: "processing",
  executionAuthorized: false,
  jobId: null,
};
export const executable = {
  ...receiptBase,
  outcome: "executable",
  executionAuthorized: true,
  jobId: "job_bg1",
};
export function saved(request = sendRequest) {
  return {
    ...scope,
    workspaceId,
    schema: "fonte_broadcast_request.v1",
    coreOrigin,
    request,
  };
}
export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
