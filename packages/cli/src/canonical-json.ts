function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const entries = Object.keys(input)
      .sort()
      .map((key) => {
        if (input[key] === undefined) throw new TypeError("undefined_value");
        return `${JSON.stringify(key)}:${canonicalValue(input[key])}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("unsupported_canonical_value");
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}
