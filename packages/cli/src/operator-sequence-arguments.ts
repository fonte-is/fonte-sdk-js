import { CliUsageError } from "./errors.js";
import type { ParsedOperatorArguments } from "./operator-types.js";
import type {
  SequenceEnvironment,
  SequenceJsonObject,
  SequenceOperatorCommand,
} from "./operator-sequence-types.js";

interface Options {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly json: boolean;
}

export function parseSequenceOperatorArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "sequence") return null;
  const operation = argv[1];
  if (operation === "list")
    return parsed(scope(argv.slice(2)), { kind: "sequence_list" });
  if (operation === "read")
    return parsed(scope(argv.slice(2), ["--sequence-id"]), {
      kind: "sequence_read",
    });
  if (operation === "create") {
    return parsed(
      scope(argv.slice(2), [
        "--sequence-id",
        "--operation-key",
        "--definition",
      ]),
      { kind: "sequence_create" },
    );
  }
  if (operation === "update") {
    return parsed(
      scope(argv.slice(2), [
        "--sequence-id",
        "--expected-revision",
        "--operation-key",
        "--definition",
      ]),
      { kind: "sequence_update" },
    );
  }
  if (operation === "validate") {
    return parsed(scope(argv.slice(2), ["--definition"]), {
      kind: "sequence_validate",
    });
  }
  if (operation === "diff") {
    return parsed(
      scope(argv.slice(2), [
        "--sequence-id",
        "--definition",
        "--base-revision",
      ]),
      { kind: "sequence_diff" },
    );
  }
  if (operation === "export") {
    return parsed(scope(argv.slice(2), ["--sequence-id"]), {
      kind: "sequence_export",
    });
  }
  if (operation === "simulate") {
    return parsed(
      scope(argv.slice(2), [
        "--sequence-id",
        "--entered-at-ms",
        "--assumed-accepted-at-ms",
      ]),
      { kind: "sequence_simulate" },
    );
  }
  invalid("invalid_field", "sequence operation");
}

function parsed(
  options: Options,
  kind: Pick<SequenceOperatorCommand, "kind">,
): ParsedOperatorArguments {
  const scoped = {
    workspace: workspace(options),
    environment: environment(options),
  };
  const command: SequenceOperatorCommand = sequenceCommand(
    kind.kind,
    options,
    scoped,
  );
  return { command, json: options.json };
}

function sequenceCommand(
  kind: SequenceOperatorCommand["kind"],
  options: Options,
  scoped: {
    readonly workspace: string;
    readonly environment: SequenceEnvironment;
  },
): SequenceOperatorCommand {
  switch (kind) {
    case "sequence_list":
      return { kind, ...scoped };
    case "sequence_read":
    case "sequence_export":
      return { kind, ...scoped, sequenceId: sequenceId(options) };
    case "sequence_create":
      return {
        kind,
        ...scoped,
        sequenceId: sequenceId(options),
        operationKey: operationKey(options),
        definition: definition(options),
      };
    case "sequence_update":
      return {
        kind,
        ...scoped,
        sequenceId: sequenceId(options),
        expectedRevision: revision(options, "--expected-revision"),
        operationKey: operationKey(options),
        definition: definition(options),
      };
    case "sequence_validate":
      return { kind, ...scoped, definition: definition(options) };
    case "sequence_diff":
      return {
        kind,
        ...scoped,
        sequenceId: sequenceId(options),
        baseRevision: optionalRevision(options, "--base-revision"),
        definition: definition(options),
      };
    case "sequence_simulate":
      return {
        kind,
        ...scoped,
        sequenceId: sequenceId(options),
        enteredAtMs: nonNegativeInteger(options, "--entered-at-ms"),
        assumedAcceptedAtMs: assumedAcceptedAtMs(options),
      };
  }
}

function scope(
  argv: readonly string[],
  additional: readonly string[] = [],
): Options {
  return options(argv, ["--workspace", "--environment", ...additional]);
}

function options(argv: readonly string[], names: readonly string[]): Options {
  const allowed = new Set(names);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--json") {
      if (flags.has(name)) invalid("duplicate_field", name);
      flags.add(name);
      continue;
    }
    if (!allowed.has(name)) invalid("unknown_field", name);
    if (values.has(name)) invalid("duplicate_field", name);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) invalid("missing_field", name);
    if (value.includes("\0")) invalid("invalid_field", name);
    values.set(name, value);
    index += 1;
  }
  return { values, flags, json: flags.has("--json") };
}

function required(options: Options, name: string): string {
  const value = options.values.get(name);
  if (!value?.trim()) invalid("missing_field", name);
  return value;
}

function workspace(options: Options): string {
  const value = required(options, "--workspace");
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  ) {
    invalid("invalid_field", "--workspace");
  }
  return value;
}

function environment(options: Options): SequenceEnvironment {
  const value = required(options, "--environment");
  if (value !== "sandbox" && value !== "production") {
    invalid("invalid_field", "--environment");
  }
  return value;
}

function sequenceId(options: Options): string {
  const value = required(options, "--sequence-id");
  if (
    value.length > 200 ||
    value === "validate" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid("invalid_field", "--sequence-id");
  }
  return value;
}

function operationKey(options: Options): string {
  const value = required(options, "--operation-key");
  if (
    value !== value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalid("invalid_field", "--operation-key");
  }
  return value;
}

function definition(options: Options): SequenceJsonObject {
  return jsonObject(required(options, "--definition"), "--definition");
}

function optionalRevision(options: Options, name: string): number | null {
  return options.values.has(name) ? revision(options, name) : null;
}

function revision(options: Options, name: string): number {
  const value = required(options, name);
  if (!/^[1-9]\d*$/.test(value)) invalid("invalid_field", name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalid("invalid_field", name);
  return parsed;
}

function nonNegativeInteger(options: Options, name: string): number {
  const value = required(options, name);
  if (!/^\d+$/.test(value)) invalid("invalid_field", name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalid("invalid_field", name);
  return parsed;
}

function assumedAcceptedAtMs(
  options: Options,
): Readonly<Record<string, number>> {
  const value = options.values.get("--assumed-accepted-at-ms");
  if (value === undefined) return {};
  const parsed = jsonObject(value, "--assumed-accepted-at-ms");
  const accepted: Record<string, number> = {};
  for (const [stepId, acceptedAtMs] of Object.entries(parsed)) {
    if (
      !stepId ||
      stepId.length > 200 ||
      stepId !== stepId.trim() ||
      /[\u0000-\u001f\u007f]/u.test(stepId) ||
      typeof acceptedAtMs !== "number" ||
      !Number.isSafeInteger(acceptedAtMs) ||
      acceptedAtMs < 0
    ) {
      invalid("invalid_field", "--assumed-accepted-at-ms");
    }
    accepted[stepId] = acceptedAtMs;
  }
  return accepted;
}

function jsonObject(value: string, field: string): SequenceJsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    invalid("invalid_field", field);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalid("invalid_field", field);
  }
  return parsed as SequenceJsonObject;
}

function invalid(
  kind: "missing_field" | "invalid_field" | "duplicate_field" | "unknown_field",
  field: string,
): never {
  throw new CliUsageError("invalid_operator_arguments", { kind, field });
}
