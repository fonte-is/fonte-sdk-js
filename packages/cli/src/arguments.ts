import type { ParsedArguments } from "./types.js";
import { CliUsageError } from "./errors.js";

/** Implement exactly the invocation grammar in CONTRACT.md. */
export function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 1 && argv[0] === "--help") {
    return { command: "help", apply: false, json: false };
  }
  if (argv.length === 1 && argv[0] === "--version") {
    return { command: "version", apply: false, json: false };
  }
  const command = argv[0];
  if (
    command !== "init" &&
    command !== "doctor" &&
    command !== "remove" &&
    command !== "test"
  ) {
    throw new CliUsageError("invalid_command");
  }
  if (command === "test") return parseTestArguments(argv.slice(1));
  const flags = new Set<string>();
  for (const flag of argv.slice(1)) {
    if ((flag !== "--yes" && flag !== "--json") || flags.has(flag)) {
      throw new CliUsageError("invalid_flag");
    }
    flags.add(flag);
  }
  if (command === "doctor" && flags.has("--yes")) {
    throw new CliUsageError("invalid_flag");
  }
  return {
    command,
    apply: flags.has("--yes"),
    json: flags.has("--json"),
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
    throw new CliUsageError("invalid_flag");
  }
  if (
    !workspaceSlug ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(workspaceSlug) ||
    workspaceSlug.includes("--")
  ) {
    throw new CliUsageError("invalid_workspace");
  }
  return { command: "test", apply: false, json, workspaceSlug };
}
