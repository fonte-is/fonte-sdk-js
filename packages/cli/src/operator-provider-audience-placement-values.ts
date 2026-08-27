export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const body = value as Record<string, unknown>;
    return `{${Object.keys(body)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(body[key])}`)
      .join(",")}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined) invalid();
  return result;
}

export function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid();
  }
  return body;
}

export function environmentValue(value: unknown): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") invalid();
  return value;
}

export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  ) {
    invalid();
  }
  return value.toLowerCase();
}

export function sha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

export function bounded(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    invalid();
  }
  return value;
}

export function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid();
  }
  return value;
}

export function positive(value: unknown): number {
  const result = count(value);
  if (result < 1) invalid();
  return result;
}

export function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}

export function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid();
  return value;
}

export function nullableSha256(value: unknown): string | null {
  return value === null ? null : sha256(value);
}

export function nullableInstant(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    invalid();
  }
  return value;
}

export function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
