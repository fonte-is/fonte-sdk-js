import { z } from "zod";
import type {
  BroadcastReviewReceipt,
  BroadcastSendReceipt,
  BroadcastSendStatus,
  ResolvedBroadcastScope,
} from "./broadcast-contracts.js";
import {
  CoreOperatorError,
  validateCoreRequestUrl,
} from "./operator-core-request.js";
import {
  broadcastCount,
  broadcastDigest,
  broadcastEnvironment,
  broadcastInstant,
  broadcastPositive,
  broadcastText,
  broadcastIdentity,
  broadcastUuid,
  requireCompactBroadcastControl,
} from "./broadcast-validation.js";

const compactRef = z.strictObject({
  id: broadcastText,
  digest: broadcastDigest,
});
const audience = z.strictObject({
  schema: z.literal("broadcast_audience.v1"),
  audienceId: broadcastText,
  digest: broadcastDigest,
  recipientCount: broadcastCount,
  selectionDigest: broadcastDigest,
  purposeRef: broadcastText,
});
const route = z.strictObject({
  schema: z.literal("broadcast_sender_route.v1"),
  routeId: broadcastText,
  digest: broadcastDigest,
  workspaceId: broadcastText,
  environment: broadcastEnvironment,
  provider: z.literal("ses_v2"),
  accountId: broadcastText,
  region: broadcastText,
  senderIdentity: broadcastText,
  authorizedFrom: broadcastText,
  tenantId: broadcastText,
  configurationSet: broadcastText,
  feedbackDestination: broadcastText,
  setupSource: broadcastText,
  setupRevision: broadcastText,
});
const review = z.strictObject({
  workspaceId: broadcastText,
  environment: broadcastEnvironment,
  draftId: broadcastIdentity(300),
  draftVersion: broadcastPositive,
  reviewId: broadcastIdentity(300),
  reviewDigest: broadcastDigest,
  createdAt: broadcastInstant,
  audienceRef: audience,
  messageRef: compactRef,
  routeRef: route,
  commercialReviewRef: compactRef,
});
const blocker = z.strictObject({
  code: z.enum([
    "draft_changed",
    "request_conflict",
    "request_superseded",
    "broadcast_audience_empty",
    "sender_route_unavailable",
    "commercial_action_required",
    "access_revoked",
    "execution_state_conflict",
  ]),
  stage: z
    .string()
    .regex(/^[a-z][a-z0-9_:.\-]{0,127}$/u)
    .optional(),
  reason: z
    .string()
    .regex(/^[a-z][a-z0-9_:.\-]{0,127}$/u)
    .optional(),
});
const operation = z.strictObject({
  operationId: broadcastUuid,
  operationVersion: broadcastPositive,
  draftId: broadcastIdentity(300),
  reviewId: broadcastIdentity(300).nullable(),
  operationUri: broadcastIdentity(2048),
  observedAt: broadcastInstant,
  blocker: blocker.optional(),
});
const reviewReceipt = operation.extend({
  state: z.enum(["queued", "running", "ready", "failed", "cancelled"]),
  executionAuthorized: z.literal(false),
  review: review.nullable(),
  summary: z
    .strictObject({
      recipientCount: broadcastCount,
      excludedCount: broadcastCount,
    })
    .nullable(),
});
const sendReceipt = operation.extend({
  outcome: z.enum(["processing", "action_required", "executable", "rejected"]),
  executionAuthorized: z.boolean(),
  jobId: broadcastText.nullable(),
});
const execution = z.strictObject({
  state: z.enum(["sending", "paused", "ended", "completed"]),
  stateVersion: broadcastCount,
  stateReason: broadcastIdentity(256).nullable(),
  observedAt: broadcastInstant,
  recipientCount: broadcastCount,
  pending: broadcastCount,
  inFlight: broadcastCount,
  accepted: broadcastCount,
  skipped: broadcastCount,
  failed: broadcastCount,
  unknown: broadcastCount,
  notSentEnded: broadcastCount,
  delivered: broadcastCount,
  attemptCount: broadcastCount,
  coverage: z.enum(["complete", "partial", "unavailable"]),
});

export function parseBroadcastReviewReceipt(
  value: unknown,
  coreOrigin: string,
  scope?: ResolvedBroadcastScope,
  effect: "none" | "unknown" = "none",
  expectedDraftVersion?: number,
): BroadcastReviewReceipt {
  return receipt(() => {
    requireCompactBroadcastControl(value);
    const parsed = reviewReceipt.parse(value);
    validateCoreRequestUrl(parsed.operationUri, coreOrigin);
    if (scope && parsed.draftId !== scope.draftId) throw new TypeError("draft");
    if (parsed.state === "ready") {
      const r = parsed.review;
      if (
        !r ||
        !parsed.summary ||
        r.reviewId !== parsed.reviewId ||
        r.draftId !== parsed.draftId ||
        r.audienceRef.recipientCount !== parsed.summary.recipientCount ||
        r.routeRef.workspaceId !== r.workspaceId ||
        r.routeRef.environment !== r.environment ||
        (scope &&
          (r.workspaceId !== scope.workspaceId ||
            r.environment !== scope.environment)) ||
        (expectedDraftVersion !== undefined &&
          r.draftVersion !== expectedDraftVersion)
      )
        throw new TypeError("review");
    } else if (parsed.review !== null || parsed.summary !== null)
      throw new TypeError("unready");
    return parsed as BroadcastReviewReceipt;
  }, effect);
}
export function parseBroadcastSendReceipt(
  value: unknown,
  coreOrigin: string,
  effect: "none" | "unknown" = "none",
  scope?: ResolvedBroadcastScope,
): BroadcastSendReceipt {
  return receipt(() => {
    requireCompactBroadcastControl(value);
    const parsed = sendReceipt.parse(value);
    validateCoreRequestUrl(parsed.operationUri, coreOrigin);
    if (scope && parsed.draftId !== scope.draftId) throw new TypeError("draft");
    if (parsed.outcome === "executable") {
      if (
        parsed.executionAuthorized !== true ||
        parsed.jobId === null ||
        parsed.reviewId === null
      )
        throw new TypeError("authority");
    } else if (parsed.executionAuthorized !== false || parsed.jobId !== null)
      throw new TypeError("authority");
    return parsed as BroadcastSendReceipt;
  }, effect);
}
export function parseBroadcastSendStatus(
  value: unknown,
  coreOrigin: string,
  scope?: ResolvedBroadcastScope,
): BroadcastSendStatus {
  return receipt(() => {
    requireCompactBroadcastControl(value);
    const parsed = sendReceipt
      .extend({ execution: execution.nullable() })
      .parse(value);
    const { execution: progress, ...base } = parsed;
    const checked = parseBroadcastSendReceipt(base, coreOrigin, "none", scope);
    if (checked.outcome !== "executable" && progress !== null)
      throw new TypeError("execution");
    // Fixed Core contract requires an execution object for executable status.
    if (checked.outcome === "executable" && progress === null)
      throw new TypeError("execution");
    return { ...checked, execution: progress };
  });
}
function receipt<T>(parse: () => T, effect: "none" | "unknown" = "none"): T {
  try {
    return parse();
  } catch {
    throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
  }
}
