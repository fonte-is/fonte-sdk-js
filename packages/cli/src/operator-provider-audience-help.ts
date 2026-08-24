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
  ];
