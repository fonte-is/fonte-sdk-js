import type { SandboxTestResult } from "./operator-types.js";

export function queuedSandboxTest(value: unknown): SandboxTestResult {
  const body = object(value);
  if (body.status !== "queued") invalid();
  const recipient = object(body.recipient);
  if (recipient.kind !== "verified_account_email") invalid();
  return {
    kind: "sandbox_test",
    test_id: text(body.sandboxEmailId),
    status: "queued",
    replayed: boolean(body.replayed),
    accepted_count: null,
    refused_count: null,
    unknown_count: null,
    accepted_email_usage_quantity: null,
    poll_after_milliseconds: null,
  };
}

export function sandboxTest(value: unknown): SandboxTestResult {
  const body = object(value);
  if (body.status !== "processing" && body.status !== "terminal") invalid();
  const provider = object(body.provider);
  const billing = object(body.billing);
  const accepted = count(provider.acceptedCount);
  const refused = count(provider.refusedCount);
  const unknown = count(provider.unknownCount);
  const quantity = nullableCount(billing.quantity);
  if (
    body.status === "terminal" &&
    (accepted + refused + unknown !== 1 || quantity !== accepted)
  )
    invalid();
  return {
    kind: "sandbox_test",
    test_id: text(body.sandboxEmailId),
    status: body.status,
    replayed: null,
    accepted_count: accepted,
    refused_count: refused,
    unknown_count: unknown,
    accepted_email_usage_quantity: quantity,
    poll_after_milliseconds: nullableCount(body.pollAfterMilliseconds),
  };
}

export function coreError(value: unknown, status: number): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string" && /^[a-z0-9_]{1,100}$/.test(error)) {
      return error;
    }
  }
  return `core_request_failed_${status}`;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return safeText(value, 500);
}

export function safeText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\p{C}/u.test(value)
  )
    invalid();
  return value;
}

export function uuid(value: unknown): string {
  const result = safeText(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) invalid();
  return result;
}

export function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

export function instant(value: unknown): string {
  const result = safeText(value, 50);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result)
    invalid();
  return result;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

export function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

export function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}

function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
