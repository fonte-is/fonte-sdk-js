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
      if (flags.has(name)) invalidProductionArguments();
      flags.add(name);
      continue;
    }
    if ((!allowed.has(name) && !repeatable.has(name)) || values.has(name)) {
      invalidProductionArguments();
    }
    const value = argv[index + 1];
    if (!value || value.includes("\0")) invalidProductionArguments();
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
    invalidProductionArguments();
  }
}

export function required(options: ProductionOptions, name: string): string {
  const value = options.values.get(name);
  if (!value?.trim()) invalidProductionArguments();
  return value;
}

export function optionalText(
  options: ProductionOptions,
  name: string,
  maximum: number,
): string | null {
  const value = options.values.get(name);
  return value === undefined ? null : boundedText(value, maximum);
}

export function workspace(options: ProductionOptions): string {
  const value = required(options, "--workspace");
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  )
    invalidProductionArguments();
  return value;
}

export function uuid(value: string): string {
  if (!UUID.test(value)) invalidProductionArguments();
  return value.toLowerCase();
}

export function versionedUuid(value: string): string {
  if (!VERSIONED_UUID.test(value)) invalidProductionArguments();
  return value.toLowerCase();
}

export function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) invalidProductionArguments();
  const result = Number(value);
  if (!Number.isSafeInteger(result)) invalidProductionArguments();
  return result;
}

export function boundedText(value: string, maximum: number): string {
  if (
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalidProductionArguments();
  return value;
}

export function content(value: string, maximum: number): string {
  if (!value.trim() || value.length > maximum || value.includes("\0")) {
    invalidProductionArguments();
  }
  return value;
}

export function idempotencyKey(value: string): string {
  if (value !== value.trim() || value.length > 200 || /\p{Cc}/u.test(value)) {
    invalidProductionArguments();
  }
  return value;
}

export function reuseOverride(
  options: ProductionOptions,
): AudienceReuseOverrideInput | null {
  const value = options.values.get("--acknowledge-audience-reuse");
  if (value === undefined) return null;
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) invalidProductionArguments();
  return {
    version: "audience_reuse_override.v1",
    audienceIdentity: value,
    acknowledged: true,
  };
}

export function invalidProductionArguments(): never {
  throw new CliUsageError("invalid_operator_arguments");
}
