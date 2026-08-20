import type { BroadcastPreflightResult } from "./operator-preflight-types.js";

export function audienceReuseEvidence(
  value: unknown,
): NonNullable<
  BroadcastPreflightResult["checks"]["audience_reuse"]["evidence"]
> {
  const body = object(value);
  const identity = object(body.identity);
  if (identity.version !== "audience_reuse_identity.v1") invalid();
  const prior =
    body.priorAuthorizationCount === null
      ? null
      : count(body.priorAuthorizationCount);
  const latest =
    body.latestAuthorizedAt === null ? null : instant(body.latestAuthorizedAt);
  const required =
    body.overrideRequired === null ? null : boolean(body.overrideRequired);
  const accepted = boolean(body.overrideAccepted);
  if (prior === null) {
    if (latest !== null || required !== null || accepted) invalid();
  } else if (
    required !== prior > 0 ||
    (prior === 0) !== (latest === null) ||
    (accepted && !required)
  )
    invalid();
  return {
    identity: {
      version: "audience_reuse_identity.v1",
      digest: audienceIdentity(identity.digest),
    },
    prior_authorization_count: prior,
    latest_authorized_at: latest,
    override_required: required,
    override_accepted: accepted,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function instant(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value)
    invalid();
  return value;
}

function audienceIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    invalid();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
