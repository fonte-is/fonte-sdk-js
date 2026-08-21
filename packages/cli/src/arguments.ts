import type { ParsedArguments } from "./types.js";
import { CliUsageError } from "./errors.js";
import { operatorHelp } from "./operator-help.js";
import { parseOperatorArguments } from "./operator-arguments.js";

/** Implement exactly the invocation grammar in CONTRACT.md. */
export function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 1 && argv[0] === "--help") {
    return { command: "help", apply: false, json: false };
  }
  if (argv.length === 1 && argv[0] === "--version") {
    return { command: "version", apply: false, json: false };
  }
  const helpText = operatorHelp(argv);
  if (helpText !== null) {
    return { command: "help", apply: false, json: false, helpText };
  }
  const command = argv[0];
  if (command === "auth") return parseAuthExecArguments(argv.slice(1));
  if (command === "broadcast" || command === "bridge") {
    const operator = parseOperatorArguments(argv);
    return {
      command: "operator",
      apply: false,
      json: operator.json,
      operator: operator.command,
    };
  }
  if (
    command !== "init" &&
    command !== "doctor" &&
    command !== "remove" &&
    command !== "test"
  ) {
    throw new CliUsageError("invalid_command", {
      kind: argv.length === 0 ? "missing_field" : "invalid_field",
      field: "command",
    });
  }
  if (command === "test") return parseTestArguments(argv.slice(1));
  const flags = new Set<string>();
  for (const flag of argv.slice(1)) {
    if ((flag !== "--yes" && flag !== "--json") || flags.has(flag)) {
      throw new CliUsageError("invalid_flag", {
        kind: flags.has(flag) ? "duplicate_field" : "unknown_field",
        field: flag,
      });
    }
    flags.add(flag);
  }
  if (command === "doctor" && flags.has("--yes")) {
    throw new CliUsageError("invalid_flag", {
      kind: "invalid_field",
      field: "--yes",
    });
  }
  return {
    command,
    apply: flags.has("--yes"),
    json: flags.has("--json"),
  };
}

function parseAuthExecArguments(argv: readonly string[]): ParsedArguments {
  const consumerCommand = argv[2];
  const consumerArguments = argv.slice(3);
  if (
    argv[0] !== "exec" ||
    argv[1] !== "--" ||
    !consumerCommand ||
    [consumerCommand, ...consumerArguments].some((value) =>
      value.includes("\0"),
    )
  ) {
    throw new CliUsageError("invalid_auth_exec", {
      kind: "invalid_field",
      field: "auth exec",
    });
  }
  return {
    command: "auth-exec",
    apply: false,
    json: false,
    consumerCommand,
    consumerArguments,
  };
}

function parseTestArguments(argv: readonly string[]): ParsedArguments {
  let json = false;
  let workspaceSlug: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json" && !json) {
      json = true;
      continue;
    }
    if (value === "--workspace" && workspaceSlug === undefined) {
      workspaceSlug = argv[index + 1];
      index += 1;
      continue;
    }
    throw new CliUsageError("invalid_flag", {
      kind: value === "--workspace" ? "duplicate_field" : "unknown_field",
      field: value ?? "invocation",
    });
  }
  if (
    !workspaceSlug ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(workspaceSlug) ||
    workspaceSlug.includes("--")
  ) {
    throw new CliUsageError("invalid_workspace", {
      kind: workspaceSlug ? "invalid_field" : "missing_field",
      field: "--workspace",
    });
  }
  return { command: "test", apply: false, json, workspaceSlug };
}
