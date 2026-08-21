import { CliUsageError } from "./errors.js";
import type { ParsedOperatorArguments } from "./operator-types.js";
import type { AudienceReuseOverrideInput } from "./operator-production-types.js";

const valueNames = new Set([
  "--workspace",
  "--environment",
  "--draft-id",
  "--expected-version",
  "--postal-address",
  "--acknowledge-audience-reuse",
]);

export function parsePreflightArguments(
  argv: readonly string[],
): ParsedOperatorArguments {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--json" && !json) {
      json = true;
      continue;
    }
    if (!valueNames.has(name)) invalid("unknown_field", name);
    if (values.has(name)) invalid("duplicate_field", name);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) invalid("missing_field", name);
    if (value.includes("\0")) invalid("invalid_field", name);
    values.set(name, value);
    index += 1;
  }
  return {
    command: {
      kind: "broadcast_preflight",
      workspace: workspace(required(values, "--workspace")),
      environment: environment(required(values, "--environment")),
      draftId: uuid(required(values, "--draft-id")),
      expectedVersion: positiveInteger(required(values, "--expected-version")),
      postalAddress: postalAddress(required(values, "--postal-address")),
      audienceReuseOverride: reuseOverride(values),
    },
    json,
  };
}

function reuseOverride(
  values: ReadonlyMap<string, string>,
): AudienceReuseOverrideInput | null {
  const value = values.get("--acknowledge-audience-reuse");
  if (value === undefined) return null;
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    invalid("invalid_field", "--acknowledge-audience-reuse");
  }
  return {
    version: "audience_reuse_override.v1",
    audienceIdentity: value,
    acknowledged: true,
  };
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (!value?.trim()) invalid("missing_field", name);
  return value;
}

function workspace(value: string): string {
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  )
    invalid("invalid_field", "--workspace");
  return value;
}

function environment(value: string): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") {
    invalid("invalid_field", "--environment");
  }
  return value;
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    invalid("invalid_field", "--draft-id");
  }
  return value;
}

function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) invalid("invalid_field", "--expected-version");
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    invalid("invalid_field", "--expected-version");
  return result;
}

function postalAddress(value: string): string {
  if (!value.trim() || value.length > 2_000) {
    invalid("invalid_field", "--postal-address");
  }
  return value;
}

function invalid(
  kind:
    | "missing_field"
    | "invalid_field"
    | "duplicate_field"
    | "unknown_field" = "invalid_field",
  field = "invocation",
): never {
  throw new CliUsageError("invalid_operator_arguments", { kind, field });
}
