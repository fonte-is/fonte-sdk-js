import { providerAudienceHelpEntries } from "./operator-provider-audience-help.js";
interface HelpEntry {
  readonly command: readonly string[];
  readonly usage: readonly (readonly string[])[];
  readonly detail: string;
  readonly json?: boolean;
}

/**
 * Kept to the parser's admitted command surface: every invocation below is
 * either parsed today or explicitly reports unsupported authority before I/O.
 */
const entries: readonly HelpEntry[] = [
  {
    command: ["init"],
    usage: [["[--yes]"]],
    detail: "Plans or applies local Fonte installation preparation.",
    json: true,
  },
  {
    command: ["doctor"],
    usage: [[]],
    detail: "Reads and verifies the existing local Fonte installation.",
    json: true,
  },
  {
    command: ["test"],
    usage: [["--workspace <slug>"]],
    detail:
      "Runs the browser-authorized hosted sandbox proof; this is distinct from broadcast test commands.",
    json: true,
  },
  {
    command: ["auth", "exec"],
    usage: [["-- <command> [args...]"]],
    detail: "Browser-authorizes and directly starts one bearer-bound child.",
  },
  {
    command: ["remove"],
    usage: [["[--yes]"]],
    detail: "Plans or applies removal of Fonte-owned local installation state.",
    json: true,
  },
  {
    command: ["broadcast", "draft", "create"],
    usage: [
      [
        "--workspace <slug> --environment production --idempotency-key <uuid>",
        "--title <title> --subject <subject> --body <html>",
        "--sender-profile-id <id> --communication-purpose-id <uuid>",
        "(--all-contacts | --include-collection <uuid> | --include-import-batch <uuid>)",
      ],
    ],
    detail:
      "Creates one persisted draft. Changed material requires a new draft UUID.",
    json: true,
  },
  {
    command: ["broadcast", "draft", "read"],
    usage: [["--workspace <slug> --environment production --draft-id <uuid>"]],
    detail: "Reads the exact persisted draft revision from Core.",
    json: true,
  },
  {
    command: ["broadcast", "audience", "options"],
    usage: [["--workspace <slug> --environment production"]],
    detail: "Lists Core-owned purposes and factual audience source IDs.",
    json: true,
  },
  {
    command: ["broadcast", "audience", "preview"],
    usage: [["--workspace <slug> --environment production --draft-id <uuid>"]],
    detail:
      "Reads Core's live candidate, protected, excluded, unknown, and eligible counts.",
    json: true,
  },
  {
    command: ["broadcast", "test", "send"],
    usage: [
      [
        "--workspace <slug> --environment sandbox --draft-id <uuid>",
        "--revision <n> --idempotency-key <key>",
      ],
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--revision <n> --postal-address <address> --idempotency-key <key>",
      ],
    ],
    detail:
      "Sandbox uses the fixed canary; production uses the signed-in account's verified address.",
    json: true,
  },
  {
    command: ["broadcast", "test", "status"],
    usage: [
      ["--workspace <slug> --environment sandbox --test-id <uuid> [--watch]"],
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--test-id <uuid> [--watch]",
      ],
    ],
    detail:
      "Production exits 0 only for a terminal, wholly accepted verified-account test.",
    json: true,
  },
  {
    command: ["broadcast", "preflight"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production> --draft-id <uuid>",
        "--expected-version <n> --postal-address <address>",
        "[--acknowledge-audience-reuse <sha256:identity>]",
      ],
    ],
    detail: "Observes every Core blocker for one exact persisted revision.",
    json: true,
  },
  {
    command: ["broadcast", "authorize"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--revision <n> --postal-address <address> --idempotency-key <key>",
        "[--acknowledge-audience-reuse <sha256:identity>]",
      ],
    ],
    detail:
      "Explicitly authorizes Core to freeze recipients and start the broadcast.",
    json: true,
  },
  {
    command: ["broadcast", "status"],
    usage: [
      [
        "--workspace <slug> --environment production --broadcast-id <uuid> [--watch]",
      ],
    ],
    detail: "Reads authoritative progress; --watch polls the same read route.",
    json: true,
  },
  ...(["pause", "resume", "cancel"] as const).map((operation) => ({
    command: ["broadcast", operation],
    usage: [
      ["--workspace <slug> --environment production --broadcast-id <uuid>"],
    ],
    detail: `${operation[0]!.toUpperCase()}${operation.slice(1)} is scoped to one broadcast and is state-idempotent in Core.`,
    json: true,
  })),
  {
    command: ["broadcast", "result"],
    usage: [
      ["--workspace <slug> --environment production --broadcast-id <uuid>"],
    ],
    detail:
      "Reads final counts, billing facts, and frozen audience provenance.",
    json: true,
  },
  {
    command: ["bridge", "observe", "resend"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production> --segment-id <id>",
      ],
    ],
    detail: "Observes one Resend segment without mutating provider state.",
    json: true,
  },
  {
    command: ["bridge", "copy", "resend"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production> --segment-id <id>",
        "--fingerprint <sha256> --idempotency-key <key>",
      ],
    ],
    detail: "Copies one fingerprint-bound Resend observation through Core.",
    json: true,
  },
  ...providerAudienceHelpEntries,
  ...(["prepare", "send", "reconcile", "watch", "duplicate"] as const).map(
    (operation) => ({
      command: ["broadcast", operation],
      usage: [[]],
      detail:
        "No current Core authority admits this declaration; it returns unsupported_authority before OAuth or network access.",
      json: true,
    }),
  ),
  ...(["status", "diff", "placement-plan"] as const).map((operation) => ({
    command: ["bridge", operation],
    usage: [[]],
    detail:
      "No current Core authority admits this declaration; it returns unsupported_authority before OAuth or network access.",
    json: true,
  })),
  {
    command: ["bridge", "observe", "kit"],
    usage: [[]],
    detail:
      "No current Core authority admits this declaration; it returns unsupported_authority before OAuth or network access.",
    json: true,
  },
  {
    command: ["bridge", "copy", "kit"],
    usage: [[]],
    detail:
      "No current Core authority admits this declaration; it returns unsupported_authority before OAuth or network access.",
    json: true,
  },
];

export function operatorHelp(argv: readonly string[]): string | null {
  if (argv.at(-1) !== "--help") return null;
  const command = argv.slice(0, -1);
  if (command.length === 1 && command[0] === "broadcast") return overview();
  const entry = entries.find((item) => equal(item.command, command));
  if (entry) return render(entry);
  const group = entries.filter((item) => startsWith(item.command, command));
  return group.length > 0 ? groupHelp(command, group) : null;
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
    ...entry.usage.flatMap((variant, variantIndex) => [
      `${variantIndex === 0 ? prefix : "   or:"}${
        variant[0] ? ` ${variant[0]}` : ""
      }${entry.json ? " [--json]" : ""}`,
      ...variant.slice(1).map((line) => `  ${line}`),
    ]),
    "",
    entry.detail,
    "OAuth is ephemeral; Core remains the sole authority for admitted operations.",
    "",
  ].join("\n");
}

function overview(): string {
  return [
    "Fonte broadcast commands:",
    ...entries
      .filter((entry) => entry.command[0] === "broadcast")
      .map((entry) => `  fonte ${entry.command.join(" ")} --help`),
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
