import { record } from "./operator-broadcast-draft-snapshot.js";

export type BroadcastTargetReference =
  | { readonly kind: "system"; readonly systemId: string }
  | { readonly kind: "one_time"; readonly oneTimeSetId: string }
  | { readonly kind: "contact"; readonly contactId: string }
  | { readonly kind: "email_domain"; readonly domain: string }
  | { readonly kind: "collection"; readonly collectionId: string }
  | {
      readonly kind: "import_batch";
      readonly contactImportBatchId: string;
    };

export type BroadcastRecipientSelection = {
  readonly to:
    | { readonly kind: "everyone" }
    | {
        readonly kind: "selected";
        readonly references: readonly BroadcastTargetReference[];
      };
  readonly except: readonly BroadcastTargetReference[];
} | null;

export function parseBroadcastRecipientSelection(
  value: unknown,
): BroadcastRecipientSelection {
  if (value === null) return null;
  const selection = record(value);
  exactKeys(selection, ["to", "except"]);
  const to = record(selection.to);
  const parsedTo = to.kind === "everyone" ? everyone(to) : selected(to);
  const except = references(selection.except, "except");
  const included = parsedTo.kind === "selected" ? parsedTo.references : [];
  const includedKeys = new Set(included.map(referenceKey));
  if (except.some((item) => includedKeys.has(referenceKey(item)))) {
    throw new TypeError("target cannot also be excluded");
  }
  return { to: parsedTo, except };
}

export function sameBroadcastRecipientSelection(
  left: BroadcastRecipientSelection,
  right: BroadcastRecipientSelection,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function everyone(value: Record<string, unknown>) {
  exactKeys(value, ["kind"]);
  return { kind: "everyone" as const };
}

function selected(value: Record<string, unknown>) {
  if (value.kind !== "selected") throw new TypeError("target kind invalid");
  exactKeys(value, ["kind", "references"]);
  return {
    kind: "selected" as const,
    references: references(value.references, "to.references"),
  };
}

function references(value: unknown, label: string): BroadcastTargetReference[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError(`${label} invalid`);
  }
  const parsed = value.map(reference);
  if (new Set(parsed.map(referenceKey)).size !== parsed.length) {
    throw new TypeError(`${label} contains duplicates`);
  }
  return parsed;
}

function reference(value: unknown): BroadcastTargetReference {
  const item = record(value);
  if (item.kind === "system") {
    exactKeys(item, ["kind", "systemId"]);
    return { kind: "system", systemId: uuid(item.systemId) };
  }
  if (item.kind === "one_time") {
    exactKeys(item, ["kind", "oneTimeSetId"]);
    return { kind: "one_time", oneTimeSetId: uuid(item.oneTimeSetId) };
  }
  if (item.kind === "contact") {
    exactKeys(item, ["kind", "contactId"]);
    return { kind: "contact", contactId: identifier(item.contactId) };
  }
  if (item.kind === "email_domain") {
    exactKeys(item, ["kind", "domain"]);
    return { kind: "email_domain", domain: domain(item.domain) };
  }
  if (item.kind === "collection") {
    exactKeys(item, ["kind", "collectionId"]);
    return { kind: "collection", collectionId: uuid(item.collectionId) };
  }
  if (item.kind === "import_batch") {
    exactKeys(item, ["kind", "contactImportBatchId"]);
    return {
      kind: "import_batch",
      contactImportBatchId: uuid(item.contactImportBatchId),
    };
  }
  throw new TypeError("target reference invalid");
}

function referenceKey(value: BroadcastTargetReference): string {
  if (value.kind === "system") return `system:${value.systemId}`;
  if (value.kind === "one_time") return `one_time:${value.oneTimeSetId}`;
  if (value.kind === "contact") return `contact:${value.contactId}`;
  if (value.kind === "email_domain") return `email_domain:${value.domain}`;
  if (value.kind === "collection") return `collection:${value.collectionId}`;
  return `import_batch:${value.contactImportBatchId}`;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((key) => !expected.includes(key))
  )
    throw new TypeError("target fields invalid");
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new TypeError("canonical UUID required");
  return value;
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    throw new TypeError("contact ID invalid");
  return value;
}

function domain(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    value !== value.trim().toLowerCase() ||
    !value.includes(".") ||
    !value
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  )
    throw new TypeError("canonical email domain required");
  return value;
}
