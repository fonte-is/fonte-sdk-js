import { readSync } from "node:fs";

import { CliUsageError } from "./errors.js";
import { SEGMENT_RULE_MAX_BYTES } from "./operator-segment-json.js";
import type {
  SegmentEnvironment,
  SegmentJsonObject,
  SegmentJsonValue,
  SegmentOperatorCommand,
} from "./operator-segment-types.js";

export interface ParsedSegmentArguments {
  readonly command: SegmentOperatorCommand;
  readonly json: boolean;
}

export type SegmentStdinReader = () => Uint8Array;

interface Options {
  readonly values: ReadonlyMap<string, string>;
  readonly json: boolean;
}

export function parseSegmentOperatorArguments(
  argv: readonly string[],
  readStdin: SegmentStdinReader = readBoundedSegmentStdin,
): ParsedSegmentArguments | null {
  if (argv[0] !== "segment") return null;
  const operation = argv[1];
  if (operation === "list") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--limit",
      "--cursor",
      "--include-archived",
    ]);
    return parsed(
      {
        kind: "segment_list",
        ...scope(options),
        ...(options.values.has("--limit")
          ? { limit: positive(options, "--limit", 50) }
          : {}),
        ...(options.values.has("--cursor")
          ? { cursor: bounded(options, "--cursor", 2_048) }
          : {}),
        ...(options.values.has("--include-archived")
          ? { includeArchived: explicitBoolean(options, "--include-archived") }
          : {}),
      },
      options,
    );
  }
  if (operation === "read") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--segment-id",
      "--revision",
    ]);
    return parsed(
      {
        kind: "segment_read",
        ...scope(options),
        segmentId: uuid(options, "--segment-id"),
        ...(options.values.has("--revision")
          ? { revision: positive(options, "--revision") }
          : {}),
      },
      options,
    );
  }
  if (operation === "create") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--segment-id",
      "--operation-id",
      "--title",
      "--rule",
    ]);
    return parsed(
      {
        kind: "segment_create",
        ...scope(options),
        segmentId: uuid(options, "--segment-id"),
        operationId: uuid(options, "--operation-id"),
        title: title(options),
        rule: rule(options, readStdin),
      },
      options,
    );
  }
  if (operation === "update") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--segment-id",
      "--operation-id",
      "--expected-revision",
      "--title",
      "--rule",
    ]);
    return parsed(
      {
        kind: "segment_update",
        ...scope(options),
        segmentId: uuid(options, "--segment-id"),
        operationId: uuid(options, "--operation-id"),
        expectedRevision: positive(options, "--expected-revision"),
        title: title(options),
        rule: rule(options, readStdin),
      },
      options,
    );
  }
  if (operation === "archive" || operation === "restore") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--segment-id",
      "--operation-id",
      "--expected-revision",
    ]);
    return parsed(
      {
        kind: "segment_archive",
        ...scope(options),
        segmentId: uuid(options, "--segment-id"),
        operationId: uuid(options, "--operation-id"),
        expectedRevision: positive(options, "--expected-revision"),
        archived: operation === "archive",
      },
      options,
    );
  }
  if (operation === "receipt") {
    const options = parseOptions(argv.slice(2), [
      "--workspace",
      "--environment",
      "--operation-id",
    ]);
    return parsed(
      {
        kind: "segment_receipt",
        ...scope(options),
        operationId: uuid(options, "--operation-id"),
      },
      options,
    );
  }
  invalid("invalid_field", "segment operation");
}

/** Reads at most 64 KiB plus one byte; overflow is rejected without truncation. */
export function readBoundedSegmentStdin(): Uint8Array {
  const input = Buffer.alloc(SEGMENT_RULE_MAX_BYTES + 1);
  let offset = 0;
  while (offset < input.byteLength) {
    const count = readSync(0, input, offset, input.byteLength - offset, null);
    if (count === 0) break;
    offset += count;
  }
  if (offset > SEGMENT_RULE_MAX_BYTES) invalid("invalid_field", "--rule");
  return input.subarray(0, offset);
}

function parsed(
  command: SegmentOperatorCommand,
  options: Options,
): ParsedSegmentArguments {
  return { command, json: options.json };
}

function rule(
  options: Options,
  readStdin: SegmentStdinReader,
): SegmentJsonObject {
  const supplied = required(options, "--rule");
  const bytes = supplied === "-" ? readStdin() : Buffer.from(supplied, "utf8");
  if (bytes.byteLength > SEGMENT_RULE_MAX_BYTES)
    invalid("invalid_field", "--rule");
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    invalid("invalid_field", "--rule");
  }
  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  )
    invalid("invalid_field", "--rule");
  jsonValue(parsedValue);
  return parsedValue as SegmentJsonObject;
}

function jsonValue(value: unknown): asserts value is SegmentJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("invalid_field", "--rule");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(jsonValue);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(jsonValue);
    return;
  }
  invalid("invalid_field", "--rule");
}

function scope(options: Options): {
  readonly workspace: string;
  readonly environment: SegmentEnvironment;
} {
  const workspace = bounded(options, "--workspace", 63);
  if (
    workspace.length < 2 ||
    workspace.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/u.test(workspace)
  )
    invalid("invalid_field", "--workspace");
  const environment = required(options, "--environment");
  if (environment !== "sandbox" && environment !== "production")
    invalid("invalid_field", "--environment");
  return { workspace, environment };
}

function parseOptions(
  argv: readonly string[],
  allowedOptions: readonly string[],
): Options {
  const allowed = new Set(allowedOptions);
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--json") {
      if (json) invalid("duplicate_field", name);
      json = true;
      continue;
    }
    if (!allowed.has(name)) invalid("unknown_field", name);
    if (values.has(name)) invalid("duplicate_field", name);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--") || value.includes("\0"))
      invalid("missing_field", name);
    values.set(name, value);
    index += 1;
  }
  return { values, json };
}

function required(options: Options, name: string): string {
  const value = options.values.get(name);
  if (value === undefined || !value.trim()) invalid("missing_field", name);
  return value;
}

function bounded(options: Options, name: string, maximumBytes: number): string {
  const value = required(options, name);
  if (
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid("invalid_field", name);
  return value;
}

function title(options: Options): string {
  const value = bounded(options, "--title", 4_096);
  if (
    value !== value.trim() ||
    Array.from(value).length < 1 ||
    Array.from(value).length > 100
  )
    invalid("invalid_field", "--title");
  return value;
}

function uuid(options: Options, name: string): string {
  const value = required(options, name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    invalid("invalid_field", name);
  return value;
}

function positive(
  options: Options,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = required(options, name);
  if (!/^[1-9][0-9]*$/u.test(value)) invalid("invalid_field", name);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum)
    invalid("invalid_field", name);
  return number;
}

function explicitBoolean(options: Options, name: string): boolean {
  const value = required(options, name);
  if (value !== "true" && value !== "false") invalid("invalid_field", name);
  return value === "true";
}

function invalid(
  kind: "missing_field" | "invalid_field" | "duplicate_field" | "unknown_field",
  field: string,
): never {
  throw new CliUsageError("invalid_operator_arguments", { kind, field });
}
