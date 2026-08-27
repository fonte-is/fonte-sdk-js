import type {
  ProductionBroadcastProgressResult,
  ProductionTestResult,
} from "./operator-production-types.js";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

export function requireProduction(value: Record<string, unknown>): void {
  if (value.environment !== "production") invalid();
}

export function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /\p{C}/u.test(value)
  )
    invalid();
  return value;
}

export function content(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    value.includes("\0")
  )
    invalid();
  return value;
}

export function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

export function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) {
    invalid();
  }
  return result.toLowerCase();
}

export function audienceIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    invalid();
  }
  return value;
}

export function instant(value: unknown): string {
  const result = text(value, 50);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== result) {
    invalid();
  }
  return result;
}

export function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
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

export function positiveInteger(value: unknown): number {
  const result = count(value);
  if (result < 1) invalid();
  return result;
}

export function nullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid();
  }
  return value;
}

export function audienceKindValue(
  value: unknown,
): "all_contacts" | "recipient_expression" {
  if (value !== "all_contacts" && value !== "recipient_expression") invalid();
  return value;
}

export function testStatus(value: unknown): ProductionTestResult["status"] {
  if (value !== "processing" && value !== "unknown" && value !== "terminal") {
    invalid();
  }
  return value;
}

export function progressStatus(
  value: unknown,
): ProductionBroadcastProgressResult["status"] {
  if (
    value !== "processing" &&
    value !== "pausing" &&
    value !== "paused" &&
    value !== "cancelling" &&
    value !== "cancelled" &&
    value !== "terminal"
  )
    invalid();
  return value;
}

export function controlVersion(value: unknown): string {
  const result = text(value, 19);
  if (
    !/^(0|[1-9][0-9]{0,18})$/.test(result) ||
    BigInt(result) > 9_223_372_036_854_775_807n
  ) {
    invalid();
  }
  return result;
}

export function controlStateValue(
  value: unknown,
): ProductionBroadcastProgressResult["control_state"] {
  if (value !== "active" && value !== "paused" && value !== "cancelled") {
    invalid();
  }
  return value;
}

export function safeProduct(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) invalid();
  return result;
}

export function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
