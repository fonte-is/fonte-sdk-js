import { z } from "zod";
import { CoreOperatorError } from "./operator-core-request.js";
import type {
  BroadcastReviewRequest,
  BroadcastSendRequest,
  SavedBroadcastRequest,
} from "./broadcast-contracts.js";

export const BROADCAST_CONTROL_BYTES = 65_536;
export const broadcastText = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      value === value.trim() &&
      new TextEncoder().encode(value).length <= 4096 &&
      !/[\u0000-\u001f\u007f]/u.test(value),
  );
export const broadcastIdentity = (maxBytes: number) =>
  broadcastText.refine(
    (value) => new TextEncoder().encode(value).length <= maxBytes,
  );
export const broadcastUuid = z
  .string()
  .regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
export const broadcastDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const broadcastCount = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const broadcastPositive = broadcastCount.refine((value) => value > 0);
export const broadcastEnvironment = z.enum(["sandbox", "production"]);
export const broadcastInstant = z
  .string()
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
export const broadcastScopeSchema = z.strictObject({
  workspace: broadcastText,
  environment: broadcastEnvironment,
  draftId: broadcastIdentity(300),
});
export const broadcastReviewRequestSchema = z.strictObject({
  schema: z.literal("broadcast_review_request.v1"),
  requestId: broadcastUuid,
  expectedDraftVersion: broadcastPositive,
  audienceMode: z
    .enum(["reuse_compatible", "refresh"])
    .default("reuse_compatible"),
});
export const broadcastSendRequestSchema = z.strictObject({
  schema: z.literal("broadcast_send_request.v2"),
  requestId: broadcastUuid,
  reviewId: broadcastIdentity(300),
  reviewDigest: broadcastDigest,
  expectedDraftVersion: broadcastPositive,
  timing: z.strictObject({ mode: z.literal("now") }),
  resume: z
    .strictObject({
      operationId: broadcastUuid,
      expectedOperationVersion: broadcastPositive,
    })
    .optional(),
});
export const savedBroadcastRequestSchema = broadcastScopeSchema.extend({
  schema: z.literal("fonte_broadcast_request.v1"),
  coreOrigin: broadcastText,
  workspaceId: broadcastText,
  request: z.union([broadcastReviewRequestSchema, broadcastSendRequestSchema]),
});

export function parseBroadcastReviewRequest(
  value: unknown,
): BroadcastReviewRequest {
  return request(() => broadcastReviewRequestSchema.parse(value));
}
export function parseBroadcastSendRequest(
  value: unknown,
): BroadcastSendRequest {
  return request(() => broadcastSendRequestSchema.parse(value));
}
export function parseSavedBroadcastRequest(
  value: unknown,
): SavedBroadcastRequest {
  return request(() => {
    requireCompactBroadcastControl(value);
    const saved = savedBroadcastRequestSchema.parse(value);
    const uri = new URL(saved.coreOrigin);
    if (uri.href !== `${uri.origin}/` || saved.coreOrigin !== uri.origin)
      throw new TypeError("origin");
    return saved;
  }, "broadcast_saved_input_recover_review_required");
}
export function requireCompactBroadcastControl(value: unknown): void {
  if (
    new TextEncoder().encode(JSON.stringify(value) ?? "").length >
    BROADCAST_CONTROL_BYTES
  ) {
    throw new TypeError("broadcast_control_size_invalid");
  }
}
/** Stable JSON is local replay identity, never a new server digest or authority. */
export function canonicalBroadcastInput(value: SavedBroadcastRequest): string {
  return orderedJson(parseSavedBroadcastRequest(value));
}
export function sameBroadcastInput(
  left: SavedBroadcastRequest,
  right: SavedBroadcastRequest,
): boolean {
  return (
    orderedJson(parseSavedBroadcastRequest(left)) ===
    orderedJson(parseSavedBroadcastRequest(right))
  );
}
export function orderedJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
}
export function request<T>(
  parse: () => T,
  reason = "broadcast_request_invalid",
): T {
  try {
    return parse();
  } catch {
    throw new CoreOperatorError(reason, null, "none");
  }
}
