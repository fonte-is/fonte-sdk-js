import { preflightAudienceEvidence } from "./operator-preflight-audience-json.js";
import { audienceReuseEvidence } from "./operator-preflight-reuse-json.js";
import type {
  BroadcastPreflightCheck,
  BroadcastPreflightResult,
} from "./operator-preflight-types.js";

export function broadcastPreflight(value: unknown): BroadcastPreflightResult {
  const body = object(value);
  if (body.schemaVersion !== "broadcast_preflight.v1") invalid();
  const checksBody = object(body.checks);
  const blockers = array(body.blockers, 100).map((value) => {
    const blocker = object(value);
    return { authority: code(blocker.authority), code: code(blocker.code) };
  });
  const checks: BroadcastPreflightResult["checks"] = {
    draft: check(checksBody.draft, draftEvidence),
    rendering: check(checksBody.rendering, noEvidence),
    authorization: check(checksBody.authorization, authorizationEvidence),
    sender: check(checksBody.sender, senderEvidence),
    audience: check(checksBody.audience, preflightAudienceEvidence),
    audience_reuse: check(checksBody.audienceReuse, audienceReuseEvidence),
    billing: check(checksBody.billing, billingEvidence),
    safety_feedback: check(checksBody.safetyFeedback, safetyEvidence),
    provider_capacity: check(checksBody.providerCapacity, capacityEvidence),
  };
  const requested = positiveInteger(body.requestedDraftVersion);
  const confirmed = nullablePositiveInteger(body.confirmedDraftVersion);
  const ready = boolean(body.ready);
  const allReady = Object.values(checks).every(
    ({ status }) => status === "ready",
  );
  if (
    (ready && (blockers.length > 0 || !allReady || confirmed !== requested)) ||
    (!ready && blockers.length === 0)
  )
    invalid();
  if (
    (confirmed === null) !== (checks.draft.evidence === null) ||
    (checks.draft.evidence && confirmed !== checks.draft.evidence.version)
  )
    invalid();
  return {
    kind: "broadcast_preflight",
    schema_version: "broadcast_preflight.v1",
    workspace_id: text(body.workspaceId, 500),
    workspace_slug: workspace(body.workspaceSlug),
    environment: environment(body.environment),
    broadcast_draft_id: uuid(body.broadcastDraftId),
    requested_draft_version: requested,
    confirmed_draft_version: confirmed,
    observed_at: instant(body.observedAt),
    ready,
    blockers,
    checks,
  };
}

function check<T>(
  value: unknown,
  evidence: (value: unknown) => T,
): BroadcastPreflightCheck<T> {
  const body = object(value);
  const status = preflightStatus(body.status);
  const reason = body.reasonCode === null ? null : code(body.reasonCode);
  if ((status === "ready") !== (reason === null)) invalid();
  return {
    status,
    reason_code: reason,
    evidence: body.evidence === null ? null : evidence(body.evidence),
  };
}

function draftEvidence(value: unknown): {
  readonly updated_at: string;
  readonly version: number;
} {
  const body = object(value);
  return {
    updated_at: instant(body.updatedAt),
    version: positiveInteger(body.version),
  };
}

function noEvidence(_value: unknown): never {
  return invalid();
}

function authorizationEvidence(value: unknown): {
  readonly render_content_digest: string;
  readonly sender_id: string;
} {
  const body = object(value);
  return {
    render_content_digest: text(body.renderContentDigest, 500),
    sender_id: text(body.senderId, 500),
  };
}

function senderEvidence(value: unknown): { readonly sender_id: string } {
  return { sender_id: text(object(value).senderId, 500) };
}

function billingEvidence(value: unknown): {
  readonly billing_required: boolean;
  readonly eligible_recipient_count: number;
  readonly reason_code: string | null;
} {
  const body = object(value);
  return {
    billing_required: boolean(body.billingRequired),
    eligible_recipient_count: count(body.eligibleRecipientCount),
    reason_code: body.reasonCode === null ? null : code(body.reasonCode),
  };
}

function safetyEvidence(value: unknown): { readonly observed_at: string } {
  return { observed_at: instant(object(value).observedAt) };
}

function capacityEvidence(
  value: unknown,
): NonNullable<
  BroadcastPreflightResult["checks"]["provider_capacity"]["evidence"]
> {
  const body = object(value);
  const maximum = count(body.max24HourSend);
  const effective = count(body.effectiveSentLast24Hours);
  const reserve = count(body.protectedTransactionalReserve);
  const remaining = count(body.dailyRemaining);
  const maxRate = nonnegativeNumber(body.maxSendRate);
  const operatingRate = nonnegativeNumber(body.operatingSendsPerSecond);
  if (
    reserve >= maximum ||
    remaining !== Math.max(0, maximum - effective - reserve) ||
    operatingRate > maxRate
  )
    invalid();
  if (body.providerHealth !== "healthy" && body.providerHealth !== "degraded")
    invalid();
  return {
    region: text(body.region, 100),
    observed_at: instant(body.observedAt),
    max_24_hour_send: maximum,
    effective_sent_last_24_hours: effective,
    protected_transactional_reserve: reserve,
    daily_remaining: remaining,
    max_send_rate: maxRate,
    operating_sends_per_second: operatingRate,
    provider_health: body.providerHealth,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function preflightStatus(
  value: unknown,
): BroadcastPreflightCheck<unknown>["status"] {
  if (
    value !== "ready" &&
    value !== "blocked" &&
    value !== "stale" &&
    value !== "unavailable"
  )
    invalid();
  return value;
}

function code(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,99}$/.test(value))
    invalid();
  return value;
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\p{C}/u.test(value)
  )
    invalid();
  return value;
}

function workspace(value: unknown): string {
  const result = text(value, 63);
  if (
    result.length < 2 ||
    result.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(result)
  )
    invalid();
  return result;
}

function environment(value: unknown): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") invalid();
  return value;
}

function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) invalid();
  return result;
}

function instant(value: unknown): string {
  const result = text(value, 50);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result)
    invalid();
  return result;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function positiveInteger(value: unknown): number {
  const result = count(value);
  if (result < 1) invalid();
  return result;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : positiveInteger(value);
}

function nonnegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid();
  return value;
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
