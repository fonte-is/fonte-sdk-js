interface HelpEntry {
  readonly command: readonly string[];
  readonly usage: readonly string[];
  readonly detail: string;
}

/**
 * Kept to the parser's admitted command surface: these are not generic HTTP
 * examples and every option below is accepted by the production parser.
 */
const entries: readonly HelpEntry[] = [
  {
    command: ["broadcast", "draft", "create"],
    usage: [
      "--workspace <slug> --environment production --idempotency-key <uuid>",
      "--title <title> --subject <subject> --body <html>",
      "--sender-profile-id <id> --communication-purpose-id <uuid>",
      "(--all-contacts | --include-collection <uuid> | --include-import-batch <uuid>)",
    ],
    detail:
      "Creates one persisted draft. Changed material requires a new draft UUID.",
  },
  {
    command: ["broadcast", "draft", "read"],
    usage: ["--workspace <slug> --environment production --draft-id <uuid>"],
    detail: "Reads the exact persisted draft revision from Core.",
  },
  {
    command: ["broadcast", "audience", "options"],
    usage: ["--workspace <slug> --environment production"],
    detail: "Lists Core-owned purposes and factual audience source IDs.",
  },
  {
    command: ["broadcast", "audience", "preview"],
    usage: ["--workspace <slug> --environment production --draft-id <uuid>"],
    detail:
      "Reads Core's live candidate, protected, excluded, unknown, and eligible counts.",
  },
  {
    command: ["broadcast", "test", "send"],
    usage: [
      "--workspace <slug> --environment production --draft-id <uuid>",
      "--revision <n> --postal-address <address> --idempotency-key <key>",
    ],
    detail: "Queues one test to the signed-in account's verified address.",
  },
  {
    command: ["broadcast", "test", "status"],
    usage: [
      "--workspace <slug> --environment production --draft-id <uuid>",
      "--test-id <uuid> [--watch]",
    ],
    detail:
      "Exit 0 requires a terminal, wholly accepted verified-account test.",
  },
  {
    command: ["broadcast", "preflight"],
    usage: [
      "--workspace <slug> --environment production --draft-id <uuid>",
      "--expected-version <n> --postal-address <address>",
      "[--acknowledge-audience-reuse <sha256:identity>]",
    ],
    detail: "Observes every Core blocker for one exact persisted revision.",
  },
  {
    command: ["broadcast", "authorize"],
    usage: [
      "--workspace <slug> --environment production --draft-id <uuid>",
      "--revision <n> --postal-address <address> --idempotency-key <key>",
      "[--acknowledge-audience-reuse <sha256:identity>]",
    ],
    detail:
      "Explicitly authorizes Core to freeze recipients and start the broadcast.",
  },
  {
    command: ["broadcast", "status"],
    usage: [
      "--workspace <slug> --environment production --broadcast-id <uuid> [--watch]",
    ],
    detail: "Reads authoritative progress; --watch polls the same read route.",
  },
  ...(["pause", "resume", "cancel"] as const).map((operation) => ({
    command: ["broadcast", operation],
    usage: [
      "--workspace <slug> --environment production --broadcast-id <uuid>",
    ],
    detail: `${operation[0]!.toUpperCase()}${operation.slice(1)} is scoped to one broadcast and is state-idempotent in Core.`,
  })),
  {
    command: ["broadcast", "result"],
    usage: [
      "--workspace <slug> --environment production --broadcast-id <uuid>",
    ],
    detail:
      "Reads final counts, billing facts, and frozen audience provenance.",
  },
];

export function operatorHelp(argv: readonly string[]): string | null {
  if (argv.at(-1) !== "--help") return null;
  const command = argv.slice(0, -1);
  if (command.length === 1 && command[0] === "broadcast") return overview();
  const group = entries.filter((item) => startsWith(item.command, command));
  if (group.length > 1) return groupHelp(command, group);
  const entry = entries.find((item) => equal(item.command, command));
  return entry ? render(entry) : null;
}

export function operatorRecoveryCommand(argv: readonly string[]): string {
  const entry = entries.find((item) =>
    item.command.every((token, index) => argv[index] === token),
  );
  return entry
    ? `fonte ${entry.command.join(" ")} --help`
    : argv[0] === "broadcast"
      ? "fonte broadcast --help"
      : "fonte --help";
}

function render(entry: HelpEntry): string {
  const prefix = `Usage: fonte ${entry.command.join(" ")}`;
  return [
    prefix,
    ...entry.usage.map((line) => `  ${line}`),
    "  [--json]",
    "",
    entry.detail,
    "OAuth is ephemeral; Core remains the sole production authority.",
    "",
  ].join("\n");
}

function overview(): string {
  return [
    "Fonte production broadcast commands:",
    ...entries.map((entry) => `  fonte ${entry.command.join(" ")} --help`),
    "",
    "Create a new draft UUID when content or audience inputs change.",
    "",
  ].join("\n");
}

function groupHelp(
  command: readonly string[],
  group: readonly HelpEntry[],
): string {
  return [
    `Fonte ${command.join(" ")} commands:`,
    ...group.map((entry) => `  fonte ${entry.command.join(" ")} --help`),
    "",
  ].join("\n");
}

function equal(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  );
}

function startsWith(
  value: readonly string[],
  prefix: readonly string[],
): boolean {
  return (
    prefix.length < value.length && prefix.every((item, i) => item === value[i])
  );
}
