import { providerAudienceHelpEntries } from "./operator-provider-audience-help.js";
import { providerEvidenceHelpEntries } from "./operator-provider-evidence-help.js";
import { workspaceMarketingSettingsHelpEntries } from "./operator-marketing-settings-help.js";
import { CAMPAIGN_OPERATOR_HELP } from "./operator-campaign-help.js";
import { SEGMENT_OPERATOR_HELP } from "./operator-segment-help.js";
export interface HelpEntry {
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
    detail: "Uses your sign-in to start one bearer-bound child.",
  },
  {
    command: ["remove"],
    usage: [["[--yes]"]],
    detail: "Plans or applies removal of Fonte-owned local installation state.",
    json: true,
  },
  {
    command: ["sequence", "list"],
    usage: [["--workspace <slug> --environment <sandbox|production>"]],
    detail: "Lists persisted Sequence drafts authorized by Fonte Core.",
    json: true,
  },
  {
    command: ["sequence", "read"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <id>",
      ],
    ],
    detail:
      "Reads one exact persisted Sequence draft and its Core-generated plan.",
    json: true,
  },
  {
    command: ["sequence", "create"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <caller-owned-id> --operation-key <key>",
        "--definition <json-object>",
      ],
    ],
    detail:
      "Creates one Core-owned Sequence draft. A caller-owned ID makes an ambiguous response safely readable without retrying the mutation.",
    json: true,
  },
  {
    command: ["sequence", "update"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <id> --expected-revision <n> --operation-key <key>",
        "--definition <json-object>",
      ],
    ],
    detail:
      "Revision-checks and idempotently updates one Sequence draft through Fonte Core.",
    json: true,
  },
  {
    command: ["sequence", "activate"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <id> --expected-revision <n> --operation-key <key>",
        "--binding <json-object>",
      ],
    ],
    detail:
      "Activates one exact Core draft revision with an opaque sender/scope/render binding. It cannot enroll, select recipients, send, or run delivery.",
    json: true,
  },
  {
    command: ["sequence", "validate"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--definition <json-object>",
      ],
    ],
    detail:
      "Validates a candidate Sequence definition in Core without saving or sending.",
    json: true,
  },
  {
    command: ["sequence", "diff"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <id> --definition <json-object>",
        "[--base-revision <n>]",
      ],
    ],
    detail: "Compares a candidate definition with one Core-persisted revision.",
    json: true,
  },
  {
    command: ["sequence", "export"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <id>",
      ],
    ],
    detail: "Exports exactly one persisted Sequence definition from Core.",
    json: true,
  },
  {
    command: ["sequence", "simulate"],
    usage: [
      [
        "--workspace <slug> --environment <sandbox|production>",
        "--sequence-id <id> --entered-at-ms <epoch-ms>",
        "[--assumed-accepted-at-ms <json-object>]",
      ],
    ],
    detail:
      "Previews a draft timeline using explicit assumed delivery acceptances; it never enrolls or sends.",
    json: true,
  },
  ...metadataHelpEntries(CAMPAIGN_OPERATOR_HELP),
  ...metadataHelpEntries(SEGMENT_OPERATOR_HELP),
  ...workspaceMarketingSettingsHelpEntries,
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
    command: ["broadcast", "audience", "append"],
    usage: [
      [
        "--workspace <slug> --environment production --broadcast-id <uuid>",
        "--frozen-audience-id <uuid> --identity-set-sha256 <sha256>",
        "--accepted-target-ceiling <n> --append-authorization-id <id>",
        "--idempotency-key <key>",
      ],
    ],
    detail:
      "Reads one authoritative append baseline, then requests one exact frozen-audience append under the supplied ceiling and idempotency key.",
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
        "--text-body <text> --html-body <html>",
      ],
    ],
    detail:
      "Sandbox uses the fixed canary; production sends explicit text and HTML to the signed-in account's verified address.",
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
    command: ["broadcast", "send", "now"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--expected-version <n> --request-id <uuid>",
      ],
    ],
    detail:
      "Accepts one saved Broadcast instruction immediately. This is the one explicit Send effect; it performs no review, audience preparation, quote, payment, or provider work.",
    json: true,
  },
  {
    command: ["broadcast", "send", "schedule"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--expected-version <n> --not-before <ISO-8601> --request-id <uuid>",
      ],
    ],
    detail:
      "Accepts one saved Broadcast instruction for the exact future time. Expensive work remains backend-owned and does not begin before it is due.",
    json: true,
  },
  {
    command: ["broadcast", "send", "status"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid> [--watch]",
      ],
    ],
    detail:
      "Observes the durable Send operation with GET only. It never prepares, authorizes, retries, or otherwise advances work.",
    json: true,
  },
  {
    command: ["broadcast", "send", "replace-schedule"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--expected-instruction-generation <n> --expected-version <n>",
        "--not-before <ISO-8601> --request-id <uuid>",
      ],
    ],
    detail:
      "Atomically replaces an unclaimed scheduled instruction with the current saved draft revision and exact timing.",
    json: true,
  },
  {
    command: ["broadcast", "send", "cancel"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--expected-instruction-generation <n> --request-id <uuid>",
      ],
    ],
    detail:
      "Requests the generation-fenced v3 cancellation through Core; it never calls a queue or provider directly.",
    json: true,
  },
  {
    command: ["broadcast", "send", "increase-limit"],
    usage: [
      [
        "--workspace <slug> --environment production --draft-id <uuid>",
        "--expected-instruction-generation <n> --expected-approval-generation <n>",
        "--request-id <uuid>",
      ],
    ],
    detail:
      "After explicit customer authority, applies Core's exact required recurring account limit and amends approval for the same operation. The client performs no cost math.",
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
  {
    command: ["broadcast", "canary"],
    usage: [
      [
        "--workspace <slug> --environment production --broadcast-id <uuid>",
        "--release-ceiling <n> --idempotency-key <key>",
      ],
    ],
    detail:
      "Reads a safe baseline, releases to one cumulative ceiling, watches acceptance, and pauses under one bound sign-in.",
    json: true,
  },
  ...(["pause", "resume", "cancel", "close"] as const).map((operation) => ({
    command: ["broadcast", operation],
    usage: [
      [
        "--workspace <slug> --environment production --broadcast-id <uuid>",
        "--expected-control-version <n>",
      ],
    ],
    detail: `${operation[0]!.toUpperCase()}${operation.slice(1)} binds Core's observed control version for a state-idempotent operation; stale opposing commands fail without retry.`,
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
  ...(["resend", "kit"] as const).flatMap((provider) => [
    {
      command: ["bridge", "connections", "list", provider],
      usage: [["--workspace <slug> --environment <sandbox|production>"]],
      detail: `Lists Core's sanitized ${provider} connection metadata.`,
      json: true as const,
    },
    {
      command: ["bridge", "connections", "connect", provider],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--display-name <name>",
        ],
      ],
      detail:
        provider === "resend"
          ? "Starts native Resend OAuth and waits when the authorization page opens."
          : "Kit OAuth is currently unavailable and fails closed until its application and scope authority exists.",
      json: true as const,
    },
    {
      command: ["bridge", "connections", "reconnect", provider],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--connection-id <uuid> --display-name <name>",
          "--expected-credential-version <n>",
        ],
      ],
      detail:
        provider === "resend"
          ? "Reauthorizes one existing connection through native Resend OAuth."
          : "Kit OAuth is currently unavailable and fails closed until its application and scope authority exists.",
      json: true as const,
    },
  ]),
  ...providerAudienceHelpEntries,
  ...providerEvidenceHelpEntries,
  ...(["prepare", "reconcile", "watch", "duplicate"] as const).map(
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
    : argv[0] === "broadcast" ||
        argv[0] === "sequence" ||
        argv[0] === "campaign" ||
        argv[0] === "segment"
      ? `fonte ${argv[0]} --help`
      : "fonte --help";
}

function metadataHelpEntries(source: string): readonly HelpEntry[] {
  return source.split("\n").map((line) => {
    const [binary, group, operation, ...tokens] = line.trim().split(/\s+/u);
    if (
      binary !== "fonte" ||
      !group ||
      !operation ||
      tokens.at(-1) !== "[--json]"
    ) {
      throw new Error("operator_metadata_help_invalid");
    }
    return {
      command: [group, operation],
      usage: [[tokens.slice(0, -1).join(" ")]],
      detail: `Uses the existing Core ${group} metadata API.`,
      json: true,
    };
  });
}

function render(entry: HelpEntry): string {
  const prefix = `Usage: fonte ${entry.command.join(" ")}`;
  const verbose = [
    "broadcast",
    "bridge",
    "campaign",
    "provider-evidence",
    "segment",
    "sequence",
  ].includes(entry.command[0]!);
  return [
    ...entry.usage.flatMap((variant, variantIndex) => [
      `${variantIndex === 0 ? prefix : "   or:"}${
        variant[0] ? ` ${variant[0]}` : ""
      }${entry.json ? " [--json]" : ""}${verbose ? " [--verbose]" : ""}`,
      ...variant.slice(1).map((line) => `  ${line}`),
    ]),
    "",
    entry.detail,
    ...(verbose
      ? ["Add --verbose for human-readable sign-in diagnostics."]
      : []),
    "Access tokens stay in memory; Core authorizes every operation.",
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
