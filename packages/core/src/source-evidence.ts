export interface SourceFields {
  readonly query: readonly string[];
  readonly cookies: readonly string[];
}
export interface SourceEvidence {
  readonly query: readonly { readonly name: string; readonly value: string }[];
  readonly cookies: readonly {
    readonly name: string;
    readonly value: string;
  }[];
}
const namePattern = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;
const valuePattern = /^[a-zA-Z0-9_.~-]{1,500}$/;
const limits = { query: 8, cookies: 2 } as const;
export function validSourceFields(value: unknown): value is SourceFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return (
    Object.keys(fields).sort().join(",") === "cookies,query" &&
    (["query", "cookies"] as const).every(
      (kind) =>
        Array.isArray(fields[kind]) &&
        fields[kind].length <= limits[kind] &&
        fields[kind].every(
          (name) => typeof name === "string" && namePattern.test(name),
        ) &&
        new Set(fields[kind]).size === fields[kind].length,
    )
  );
}
export function normalizeSourceEvidence(value: unknown): SourceEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== "cookies,query") return null;
  const result: {
    query: { name: string; value: string }[];
    cookies: { name: string; value: string }[];
  } = { query: [], cookies: [] };
  for (const kind of ["query", "cookies"] as const) {
    const entries = fields[kind];
    if (!Array.isArray(entries) || entries.length > limits[kind]) return null;
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !== "name,value" ||
        typeof entry.name !== "string" ||
        !namePattern.test(entry.name) ||
        typeof entry.value !== "string" ||
        !valuePattern.test(entry.value) ||
        result[kind].some((prior) => prior.name === entry.name)
      )
        return null;
      result[kind].push({ name: entry.name, value: entry.value });
    }
    result[kind].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  }
  return result;
}
