import { CliUsageError } from "./errors.js";
import type { AudienceReuseOverrideInput } from "./operator-production-types.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const VERSIONED_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProductionOptions {
  readonly values: ReadonlyMap<string, string>;
  readonly repeated: ReadonlyMap<string, readonly string[]>;
  readonly flags: ReadonlySet<string>;
  readonly json: boolean;
}

export function productionRead(
  argv: readonly string[],
  names: readonly string[] = [],
  repeated: readonly string[] = [],
  flags: readonly string[] = [],
): ProductionOptions {
  const options = parseProductionOptions(
    argv,
    ["--workspace", "--environment", ...names],
    repeated,
    flags,
  );
  requireProduction(options);
  return options;
}

export function parseProductionOptions(
  argv: readonly string[],
  names: readonly string[],
  repeatedNames: readonly string[] = [],
  flagNames: readonly string[] = [],
): ProductionOptions {
  const allowed = new Set(names);
  const repeatable = new Set(repeatedNames);
  const allowedFlags = new Set(["--json", ...flagNames]);
  const values = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (allowedFlags.has(name)) {
      if (flags.has(name)) {
        invalidProductionArguments("duplicate_field", name);
      }
      flags.add(name);
      continue;
    }
    if (!allowed.has(name) && !repeatable.has(name)) {
      invalidProductionArguments("unknown_field", name);
    }
    if (values.has(name)) {
      invalidProductionArguments("duplicate_field", name);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      invalidProductionArguments("missing_field", name);
    }
    if (value.includes("\0")) invalidProductionArguments("invalid_field", name);
    if (repeatable.has(name)) {
      repeated.set(name, [...(repeated.get(name) ?? []), value]);
    } else {
      values.set(name, value);
    }
    index += 1;
  }
  return { values, repeated, flags, json: flags.has("--json") };
}

export function operatorArguments(
  options: ProductionOptions,
  command: Exclude<
    ParsedOperatorArguments["command"],
    { readonly kind: "unsupported" }
  >,
): ParsedOperatorArguments {
  return { command, json: options.json };
}

export function isProduction(argv: readonly string[]): boolean {
  const index = argv.indexOf("--environment");
  return index >= 0 && argv[index + 1] === "production";
}

export function requireProduction(options: ProductionOptions): void {
  if (required(options, "--environment") !== "production") {
    invalidProductionArguments("invalid_field", "--environment");
  }
}

export function required(options: ProductionOptions, name: string): string {
  const value = options.values.get(name);
  if (!value?.trim()) invalidProductionArguments("missing_field", name);
  return value;
}

export function optionalText(
  options: ProductionOptions,
  name: string,
  maximum: number,
): string | null {
  const value = options.values.get(name);
  return value === undefined ? null : boundedText(value, maximum, name);
}

export function workspace(options: ProductionOptions): string {
  const value = required(options, "--workspace");
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  )
    invalidProductionArguments("invalid_field", "--workspace");
  return value;
}

export function uuid(value: string, field = "value"): string {
  if (!UUID.test(value)) invalidProductionArguments("invalid_field", field);
  return value.toLowerCase();
}

export function versionedUuid(value: string, field = "value"): string {
  if (!VERSIONED_UUID.test(value)) {
    invalidProductionArguments("invalid_field", field);
  }
  return value.toLowerCase();
}

export function positiveInteger(value: string, field = "value"): number {
  if (!/^[1-9]\d*$/.test(value)) {
    invalidProductionArguments("invalid_field", field);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    invalidProductionArguments("invalid_field", field);
  }
  return result;
}

export function controlVersion(value: string, field = "value"): string {
  if (
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > 9_223_372_036_854_775_807n
  ) {
    invalidProductionArguments("invalid_field", field);
  }
  return value;
}

export function boundedText(
  value: string,
  maximum: number,
  field = "value",
): string {
  if (
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalidProductionArguments("invalid_field", field);
  return value;
}

export function content(
  value: string,
  maximum: number,
  field = "value",
): string {
  if (!value.trim() || value.length > maximum || value.includes("\0")) {
    invalidProductionArguments("invalid_field", field);
  }
  return value;
}

export function idempotencyKey(
  value: string,
  field = "--idempotency-key",
): string {
  if (value !== value.trim() || value.length > 200 || /\p{Cc}/u.test(value)) {
    invalidProductionArguments("invalid_field", field);
  }
  return value;
}

export function sha256(value: string, field = "value"): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    invalidProductionArguments("invalid_field", field);
  }
  return value;
}

export function reuseOverride(
  options: ProductionOptions,
): AudienceReuseOverrideInput | null {
  const value = options.values.get("--acknowledge-audience-reuse");
  if (value === undefined) return null;
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    invalidProductionArguments("invalid_field", "--acknowledge-audience-reuse");
  }
  return {
    version: "audience_reuse_override.v1",
    audienceIdentity: value,
    acknowledged: true,
  };
}

export function invalidProductionArguments(
  kind:
    | "missing_field"
    | "invalid_field"
    | "duplicate_field"
    | "unknown_field" = "invalid_field",
  field = "invocation",
): never {
  throw new CliUsageError("invalid_operator_arguments", { kind, field });
}
