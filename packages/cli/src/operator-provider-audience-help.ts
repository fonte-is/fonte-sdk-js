export interface ProviderAudienceHelpEntry {
  readonly command: readonly string[];
  readonly usage: readonly (readonly string[])[];
  readonly detail: string;
  readonly json: true;
}

export const providerAudienceHelpEntries: readonly ProviderAudienceHelpEntry[] =
  [
    {
      command: ["bridge", "import", "status"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--contact-import-batch-id <uuid>",
        ],
      ],
      detail:
        "Reads Core's completed Contact-import identity-set SHA-256 for exact Bridge reconciliation.",
      json: true,
    },
    {
      command: ["bridge", "collections", "resend"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--connection-id <uuid>",
        ],
      ],
      detail:
        "Lists every Resend segment visible through one Core-owned connection.",
      json: true,
    },
    {
      command: ["bridge", "collections", "kit"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--connection-id <uuid>",
        ],
      ],
      detail: "Lists every Kit tag visible through one Core-owned connection.",
      json: true,
    },
    {
      command: ["bridge", "reconcile"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--source-provider <resend|kit> --source-connection-id <uuid>",
          "--source-collection-id <id> --source-display-name <name>",
          "--max-age-seconds <1..86400>",
          "[--exclude-provider <resend|kit> --exclude-connection-id <uuid>",
          " --exclude-collection-id <id> --exclude-display-name <name>]...",
        ],
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--source-import-batch-id <uuid>",
          "--source-identity-set-sha256 <sha256>",
          "[--max-age-seconds <1..86400>",
          " --exclude-provider <resend|kit> --exclude-connection-id <uuid>",
          " --exclude-collection-id <id> --exclude-display-name <name>]...",
        ],
      ],
      detail:
        "Reads Core's exact protected/excluded/unknown/final reconciliation without exposing contacts.",
      json: true,
    },
    {
      command: ["bridge", "freeze"],
      usage: [
        [
          "<the exact bridge reconcile source, exclusions, and max-age flags>",
          "--fingerprint <sha256> --idempotency-key <key>",
          "[--declare-marketing-permission]",
        ],
      ],
      detail:
        "Explicitly freezes only the fingerprint-bound final audience into an immutable Core reference. --declare-marketing-permission confirms independent valid marketing permission; existing unsubscribe, suppression, and purpose blocks remain authoritative.",
      json: true,
    },
    {
      command: ["bridge", "placement", "apply"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--application-file <aggregate-certificate-application.json>",
        ],
      ],
      detail:
        "Applies or resumes one exact certificate-bound provider retirement/refill application. On response loss, read progress before deciding whether to submit the same application again; the CLI never retries automatically.",
      json: true,
    },
    {
      command: ["bridge", "placement", "progress"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--application-file <the-same-aggregate-certificate-application.json>",
        ],
      ],
      detail:
        "Reads durable aggregate reconciliation for the exact application idempotency key and verifies the complete application binding without provider contact through the CLI.",
      json: true,
    },
    {
      command: ["bridge", "rotation", "start"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--iteration-id <uuid> --connection-id <uuid>",
          "--candidate-operation-id <uuid>",
          "--outgoing-candidate-operation-id <uuid>",
          "--population-selector-generation-id <uuid>",
          "--placement-segment-id <uuid>",
          "--qualifying-broadcast-id <uuid>",
          "--ordered-broadcast-id <uuid> [--ordered-broadcast-id <uuid>]...",
          "--cold-remaining <nonnegative-integer>",
          "--identity-key-id <Core-custody-key-id>",
          "--identity-normalization-version <positive-integer>",
        ],
      ],
      detail:
        "Starts one fresh private two-pass Resend population and exact named-broadcast recipient acquisition through Core's stored GET-only credential, bound to the placement segment used by the sealed Fonte intake. The CLI emits aggregate receipts only and never accepts candidate rows or provider credentials.",
      json: true,
    },
    {
      command: ["bridge", "rotation", "advance"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--iteration-id <uuid> --expected-page-number <positive-integer>",
        ],
      ],
      detail:
        "Advances exactly one stored-credential population or named-broadcast GET page. On response loss, run rotation read and use its nextPageNumber before another advance; the CLI never retries automatically.",
      json: true,
    },
    {
      command: ["bridge", "rotation", "read"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--iteration-id <uuid>",
        ],
      ],
      detail:
        "Reads only aggregate population, checkpoint, classification, selector, and checksum receipts for one exact iteration.",
      json: true,
    },
    {
      command: ["bridge", "rotation", "seal"],
      usage: [
        [
          "--workspace <slug> --environment <sandbox|production>",
          "--iteration-id <uuid> --candidate-generation-id <uuid>",
          "--partition-generation-id <uuid>",
          "--qualifying-broadcast-id <uuid>",
          "--ordered-broadcast-id <uuid> [--ordered-broadcast-id <uuid>]...",
        ],
      ],
      detail:
        "Seals the fresh exhaustive E/W/X/U partition from Core-held evidence. Any unknown category blocks the outgoing selector; response loss requires rotation read before another seal.",
      json: true,
    },
  ];
