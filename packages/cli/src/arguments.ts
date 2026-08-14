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
  if (command !== "init" && command !== "doctor" && command !== "remove") {
    throw new CliUsageError("invalid_command");
  }
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
