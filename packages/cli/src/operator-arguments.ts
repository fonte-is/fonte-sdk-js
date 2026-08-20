import { CliUsageError } from "./errors.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

const missingBroadcast = new Set([
  "draft",
  "audience",
  "preflight",
  "authorize",
  "status",
  "watch",
  "pause",
  "resume",
  "cancel",
  "duplicate",
]);
const bridgeDeclarations = new Set([
  "observe",
  "status",
  "diff",
  "placement-plan",
  "copy",
  "reconcile",
]);

export function parseOperatorArguments(
  argv: readonly string[],
): ParsedOperatorArguments {
  if (argv[0] === "broadcast" && argv[1] === "test") {
    if (argv[2] === "send") return testSend(argv.slice(3));
    if (argv[2] === "status") return testStatus(argv.slice(3));
  }
  if (
    (argv[0] === "broadcast" && missingBroadcast.has(argv[1] ?? "")) ||
    (argv[0] === "bridge" && bridgeDeclarations.has(argv[1] ?? ""))
  ) {
    return unsupported(argv.slice(2));
  }
  throw new CliUsageError("invalid_operator_command");
}

function testSend(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseOptions(argv, [
    "--workspace",
    "--environment",
    "--draft-id",
    "--revision",
    "--idempotency-key",
  ]);
  if (required(options, "--environment") !== "sandbox") invalid();
  return {
    command: {
      kind: "broadcast_test_send",
      workspace: workspace(options),
      draftId: uuid(options, "--draft-id"),
      revision: positiveInteger(options, "--revision"),
      idempotencyKey: idempotencyKey(options),
    },
    json: options.json,
  };
}

function testStatus(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseOptions(
    argv,
    ["--workspace", "--environment", "--test-id"],
    ["--watch"],
  );
  if (required(options, "--environment") !== "sandbox") invalid();
  return {
    command: {
      kind: "broadcast_test_status",
      workspace: workspace(options),
      testId: uuid(options, "--test-id"),
      watch: options.flags.has("--watch"),
    },
    json: options.json,
  };
}

function unsupported(argv: readonly string[]): ParsedOperatorArguments {
  if (argv.some((value) => value.includes("\0"))) invalid();
  const jsonCount = argv.filter((value) => value === "--json").length;
  if (jsonCount > 1) invalid();
  return { command: { kind: "unsupported" }, json: jsonCount === 1 };
}

interface Options {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly json: boolean;
}

function parseOptions(
  argv: readonly string[],
  valueNames: readonly string[],
  flagNames: readonly string[] = [],
): Options {
  const allowedValues = new Set(valueNames);
  const allowedFlags = new Set(["--json", ...flagNames]);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (allowedFlags.has(name) && !flags.has(name)) {
      flags.add(name);
      continue;
    }
    if (!allowedValues.has(name) || values.has(name)) invalid();
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || value.includes("\0")) invalid();
    values.set(name, value);
    index += 1;
  }
  return { values, flags, json: flags.has("--json") };
}

function required(options: Options, name: string): string {
  const value = options.values.get(name);
  if (!value?.trim()) invalid();
  return value;
}

function workspace(options: Options): string {
  const value = required(options, "--workspace");
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  )
    invalid();
  return value;
}

function uuid(options: Options, name: string): string {
  const value = required(options, name);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) invalid();
  return value;
}

function positiveInteger(options: Options, name: string): number {
  const value = required(options, name);
  if (!/^[1-9]\d*$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalid();
  return parsed;
}

function idempotencyKey(options: Options): string {
  const value = required(options, "--idempotency-key");
  if (value !== value.trim() || value.length > 200) invalid();
  return value;
}

function invalid(): never {
  throw new CliUsageError("invalid_operator_arguments");
}
