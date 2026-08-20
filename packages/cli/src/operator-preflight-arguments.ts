import { CliUsageError } from "./errors.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

const valueNames = new Set([
  "--workspace",
  "--environment",
  "--draft-id",
  "--expected-version",
  "--postal-address",
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
    if (!valueNames.has(name) || values.has(name)) invalid();
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || value.includes("\0")) invalid();
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
    },
    json,
  };
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (!value?.trim()) invalid();
  return value;
}

function workspace(value: string): string {
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  )
    invalid();
  return value;
}

function environment(value: string): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") invalid();
  return value;
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) invalid();
  return value;
}

function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) invalid();
  const result = Number(value);
  if (!Number.isSafeInteger(result)) invalid();
  return result;
}

function postalAddress(value: string): string {
  if (!value.trim() || value.length > 2_000) invalid();
  return value;
}

function invalid(): never {
  throw new CliUsageError("invalid_operator_arguments");
}
