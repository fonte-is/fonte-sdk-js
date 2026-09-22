export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    invalid();
}

export function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

export function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid();
  return value;
}

export function uuid(value: unknown): string {
  const result = text(value, 36).toLowerCase();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(result)) invalid();
  return result;
}

export function instant(value: unknown): string {
  const result = text(value, 50);
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    invalid();
  return result;
}

export function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}

export function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

export function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

export function positiveInteger(value: unknown): number {
  const result = count(value);
  if (result < 1) invalid();
  return result;
}

export function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}

export function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
