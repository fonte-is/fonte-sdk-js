import path from "node:path";

import {
  invalidProductionArguments,
  parseProductionOptions,
  required,
  workspace,
} from "./operator-production-options.js";
import type {
  BroadcastPavedRequest,
  BroadcastPavedSendInput,
} from "./operator-broadcast-paved.js";

export type ParsedBroadcastPavedCommand =
  | {
      readonly action: "prepare";
      readonly input: BroadcastPavedRequest;
    }
  | {
      readonly action: "send";
      readonly input: BroadcastPavedSendInput;
    };

export function parseBroadcastPavedArguments(
  argv: readonly string[],
): ParsedBroadcastPavedCommand | null {
  if (argv[0] !== "broadcast") return null;
  if (argv[1] === "prepare") return prepare(argv.slice(2));
  if (argv[1] === "send" && argv[2] === "--send-input") {
    return send(argv.slice(2));
  }
  return null;
}

function prepare(argv: readonly string[]): ParsedBroadcastPavedCommand {
  const options = parseProductionOptions(argv, [
    "--workspace",
    "--draft-id",
    "--audience-file",
  ]);
  if (!options.json) invalidProductionArguments("missing_field", "--json");
  const audienceFile = required(options, "--audience-file");
  if (!path.isAbsolute(audienceFile)) {
    invalidProductionArguments("invalid_field", "--audience-file");
  }
  return {
    action: "prepare",
    input: {
      workspace_selector: workspace(options),
      draft_id: uuid(required(options, "--draft-id"), "--draft-id"),
      audience_file: audienceFile,
    },
  };
}

function send(argv: readonly string[]): ParsedBroadcastPavedCommand {
  const options = parseProductionOptions(argv, ["--send-input"]);
  if (!options.json) invalidProductionArguments("missing_field", "--json");
  const serialized = required(options, "--send-input");
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    invalidProductionArguments("invalid_field", "--send-input");
  }
  return { action: "send", input: sendInput(value) };
}

function sendInput(value: unknown): BroadcastPavedSendInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidProductionArguments("invalid_field", "--send-input");
  }
  const input = value as Record<string, unknown>;
  const fields = [
    "workspace",
    "draft_id",
    "expected_revision",
    "snapshot_sha256",
    "request_id",
  ];
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !fields.includes(field)) ||
    typeof input.workspace !== "string" ||
    input.workspace.length < 2 ||
    input.workspace.length > 63 ||
    input.workspace.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/u.test(input.workspace) ||
    typeof input.expected_revision !== "number" ||
    !Number.isSafeInteger(input.expected_revision) ||
    input.expected_revision < 1 ||
    typeof input.snapshot_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.snapshot_sha256)
  ) {
    invalidProductionArguments("invalid_field", "--send-input");
  }
  return {
    workspace: input.workspace,
    draft_id: uuidString(input.draft_id),
    expected_revision: input.expected_revision,
    snapshot_sha256: input.snapshot_sha256,
    request_id: uuidString(input.request_id),
  };
}

function uuid(value: string, field: string): string {
  const parsed = uuidString(value);
  if (parsed !== value) invalidProductionArguments("invalid_field", field);
  return parsed;
}

function uuidString(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value) ||
    value !== value.toLowerCase()
  ) {
    invalidProductionArguments("invalid_field", "--send-input");
  }
  return value;
}
