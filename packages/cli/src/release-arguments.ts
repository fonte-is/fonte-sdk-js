import type { ParsedArguments } from "./types.js";
import { CliUsageError } from "./errors.js";
import { RELEASE_HELP_TEXT } from "./constants.js";

export function parseReleaseArguments(
  argv: readonly string[],
): ParsedArguments {
  if (argv.length === 1 && argv[0] === "--help") {
    return {
      command: "help",
      apply: false,
      json: false,
      helpText: RELEASE_HELP_TEXT,
    };
  }
  if (argv.length !== 2 || argv[0] !== "--source") {
    throw new CliUsageError("invalid_release_arguments", {
      kind: "invalid_field",
      field: argv[0] ?? "--source",
    });
  }
  if (!/^[0-9a-f]{40}$/.test(argv[1])) {
    throw new CliUsageError("invalid_release_source", {
      kind: "invalid_field",
      field: "--source",
    });
  }
  return {
    command: "release",
    apply: false,
    json: false,
    releaseSource: argv[1],
  };
}
