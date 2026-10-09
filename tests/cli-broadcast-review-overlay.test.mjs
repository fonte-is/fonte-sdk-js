import assert from "node:assert/strict";
import test from "node:test";
import { parseBroadcastReviewReceipt } from "../packages/cli/dist/broadcast-receipts.js";
import {
  coreOrigin,
  scope,
  workspaceId,
  review,
  ready,
} from "./fixtures/broadcast-bg1.mjs";

const resolved = { ...scope, workspaceId };
const sourceChangedReason =
  "source_generation_changed:latest_source_event=provider_feedback_events";
const failedSource = {
  ...ready,
  state: "failed",
  reviewId: null,
  review: null,
  summary: null,
  blocker: {
    code: "broadcast_audience_unavailable",
    stage: "review",
    reason: sourceChangedReason,
  },
};
const reduced = (recipientCount) => ({
  ...ready,
  summary: {
    recipientCount,
    excludedCount: review.audienceRef.recipientCount - recipientCount,
  },
});

for (const recipientCount of [review.audienceRef.recipientCount - 3, 0]) {
  test(`a ready Review accepts ${recipientCount} current recipients without changing immutable evidence`, () => {
    const before = structuredClone(review);
    const value = reduced(recipientCount);
    const parsed = parseBroadcastReviewReceipt(
      value,
      coreOrigin,
      resolved,
      "unknown",
      1,
    );
    assert.deepEqual(parsed, value);
    assert.deepEqual(parsed.review, before);
    assert.deepEqual(review, before);
    assert.equal(parsed.executionAuthorized, false);
    assert.equal(parsed.review.reviewDigest, ready.review.reviewDigest);
    assert.equal(
      parsed.review.commercialReviewRef.digest,
      ready.review.commercialReviewRef.digest,
    );
  });
}

test("a current count above the sealed audience remains an invalid Review receipt", () => {
  assert.throws(
    () =>
      parseBroadcastReviewReceipt(
        {
          ...ready,
          summary: {
            recipientCount: review.audienceRef.recipientCount + 1,
            excludedCount: 0,
          },
        },
        coreOrigin,
        resolved,
        "unknown",
        1,
      ),
    (error) =>
      error.reason === "core_operator_receipt_invalid" &&
      error.coreEffect === "unknown",
  );
});

test("a smaller current count preserves tenant, draft, version, identity and digest validation", () => {
  const value = reduced(review.audienceRef.recipientCount - 3);
  for (const changed of [
    { ...review, workspaceId: "foreign-workspace" },
    { ...review, environment: "production" },
    { ...review, draftId: "foreign-draft" },
    { ...review, draftVersion: 2 },
    { ...review, reviewId: "foreign-review" },
    { ...review, reviewDigest: "invalid-digest" },
    {
      ...review,
      routeRef: { ...review.routeRef, workspaceId: "foreign-workspace" },
    },
    {
      ...review,
      routeRef: { ...review.routeRef, schema: "broadcast_sender_route.v1" },
    },
    {
      ...review,
      routeRef: { ...review.routeRef, unrecognizedRouteData: "unexpected" },
    },
    {
      ...review,
      commercialReviewRef: {
        ...review.commercialReviewRef,
        digest: "invalid-digest",
      },
    },
  ])
    assert.throws(
      () =>
        parseBroadcastReviewReceipt(
          { ...value, review: changed },
          coreOrigin,
          resolved,
          "none",
          1,
        ),
      (error) =>
        error.reason === "core_operator_receipt_invalid" &&
        error.coreEffect === "none",
    );
});

test("a source generation invalidation remains a readable failed Review without sending authority", () => {
  assert.deepEqual(
    parseBroadcastReviewReceipt(
      failedSource,
      coreOrigin,
      resolved,
      "unknown",
      1,
    ),
    failedSource,
  );
});

test("Core diagnostic reasons retain bounded safe characters and the existing stage grammar", () => {
  const withReason = (reason) => ({
    ...failedSource,
    blocker: { ...failedSource.blocker, reason },
  });
  const maximumReason = `a${"=".repeat(127)}`;
  assert.deepEqual(
    parseBroadcastReviewReceipt(
      withReason(maximumReason),
      coreOrigin,
      resolved,
    ),
    withReason(maximumReason),
  );
  for (const reason of [
    "",
    `a${"=".repeat(128)}`,
    `${sourceChangedReason}\n`,
    `${sourceChangedReason} other`,
    `${sourceChangedReason};other`,
    `${sourceChangedReason}<script>`,
    "=provider_feedback_events",
    "source%3Devent",
    "source/event",
  ])
    assert.throws(
      () =>
        parseBroadcastReviewReceipt(withReason(reason), coreOrigin, resolved),
      (error) => error.reason === "core_operator_receipt_invalid",
    );
  assert.throws(
    () =>
      parseBroadcastReviewReceipt(
        {
          ...failedSource,
          blocker: { ...failedSource.blocker, stage: "review=source" },
        },
        coreOrigin,
        resolved,
      ),
    (error) => error.reason === "core_operator_receipt_invalid",
  );
});
