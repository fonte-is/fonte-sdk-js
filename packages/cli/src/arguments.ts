import type { ParsedArguments } from "./types.js";
import { CliUsageError } from "./errors.js";
import { operatorHelp } from "./operator-help.js";
import { parseOperatorArguments } from "./operator-arguments.js";
import { AUTH_HELP_TEXT } from "./auth-commands.js";

/** Implement exactly the invocation grammar in CONTRACT.md. */
export function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 1 && argv[0] === "--help") {
    return { command: "help", apply: false, json: false };
  }
  if (argv.length === 1 && argv[0] === "--version") {
    return { command: "version", apply: false, json: false };
  }
  if (
    argv[0] === "auth" &&
    ((argv.length === 2 && argv[1] === "--help") ||
      (argv.length === 3 &&
        ["login", "status", "logout"].includes(argv[1]!) &&
        argv[2] === "--help"))
  ) {
    return {
      command: "help",
      apply: false,
      json: false,
      helpText: AUTH_HELP_TEXT,
    };
  }
  const helpText = operatorHelp(argv);
  if (helpText !== null) {
    return { command: "help", apply: false, json: false, helpText };
  }
  const command = argv[0];
  if (command === "setup") return parseSetupArguments(argv.slice(1));
  if (command === "status") return parseStatusArguments(argv.slice(1));
  if (command === "auth") return parseAuthArguments(argv.slice(1));
  if (
    command === "broadcast" ||
    command === "bridge" ||
    command === "provider-evidence" ||
    command === "sequence" ||
    command === "campaign" ||
    command === "segment"
  ) {
    const operator = parseOperatorArguments(argv);
    return {
      command: "operator",
      apply: false,
      json: operator.json,
      ...(operator.verbose ? { verbose: true } : {}),
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

function parseSetupArguments(argv: readonly string[]): ParsedArguments {
  let json = false;
  let verbose = false;
  let workspaceSlug: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json" && !json) {
      json = true;
      continue;
    }
    if (value === "--verbose" && !verbose) {
      verbose = true;
      continue;
    }
    if (value === "--workspace" && workspaceSlug === undefined) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--"))
        throw new CliUsageError("invalid_setup_flags", {
          kind: "missing_field",
          field: "--workspace",
        });
      workspaceSlug = next;
      index += 1;
      continue;
    }
    throw new CliUsageError("invalid_setup_flags", {
      kind: value === "--workspace" ? "missing_field" : "unknown_field",
      field: value ?? "setup",
    });
  }
  if (
    workspaceSlug !== undefined &&
    (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(workspaceSlug) ||
      workspaceSlug.includes("--"))
  ) {
    throw new CliUsageError("invalid_workspace", {
      kind: "invalid_field",
      field: "--workspace",
    });
  }
  return {
    command: "setup",
    apply: false,
    json,
    ...(verbose ? { verbose: true } : {}),
    ...(workspaceSlug === undefined ? {} : { workspaceSlug }),
  };
}

function parseStatusArguments(argv: readonly string[]): ParsedArguments {
  let json = false;
  let verbose = false;
  for (const flag of argv) {
    if (flag === "--json" && !json) {
      json = true;
      continue;
    }
    if (flag === "--verbose" && !verbose) {
      verbose = true;
      continue;
    }
    throw new CliUsageError("invalid_status_flags", {
      kind:
        flag === "--json" || flag === "--verbose"
          ? "duplicate_field"
          : "unknown_field",
      field: flag,
    });
  }
  return {
    command: "status",
    apply: false,
    json,
    ...(verbose ? { verbose: true } : {}),
  };
}

function parseAuthArguments(argv: readonly string[]): ParsedArguments {
  const action = argv[0];
  if (action === "login" || action === "status" || action === "logout") {
    const flags = argv.slice(1);
    if (
      new Set(flags).size !== flags.length ||
      flags.some(
        (flag) =>
          flag !== "--json" &&
          flag !== "--verbose" &&
          !(action === "login" && flag === "--switch-account"),
      )
    ) {
      throw new CliUsageError("invalid_auth_flags", {
        kind: "invalid_field",
        field: "auth",
      });
    }
    return {
      command: "auth-session",
      authAction: action,
      apply: false,
      json: flags.includes("--json"),
      switchAccount: flags.includes("--switch-account"),
      ...(flags.includes("--verbose") ? { verbose: true } : {}),
    };
  }
  const verbose = argv[1] === "--verbose";
  const separator = verbose ? argv[2] : argv[1];
  const consumerCommand = argv[verbose ? 3 : 2];
  const consumerArguments = argv.slice(verbose ? 4 : 3);
  if (
    argv[0] !== "exec" ||
    separator !== "--" ||
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
    ...(verbose ? { verbose: true } : {}),
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
