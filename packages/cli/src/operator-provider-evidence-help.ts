import type { HelpEntry } from "./operator-help.js";

const scope = [
  "--workspace <slug> --environment <sandbox|production>",
  "--connection-id <uuid> --selector-id <id>",
  "--selector-generation-id <uuid> --artifact-sha256 <sha256>",
  "--identity-set-sha256 <sha256> --candidate-count <n>",
  "--candidate-manifest-sha256 <sha256>",
] as const;
const sourceScope = scope.slice(0, -1);

export const providerEvidenceHelpEntries: readonly HelpEntry[] = [
  {
    command: ["provider-evidence", "resend", "start"],
    usage: [
      [
        ...scope,
        "--operation-id <uuid> --candidates-file <json-file>",
        "--schema-version <version> --normalization-version <version>",
        "--identity-fingerprint-version tenant_hmac_sha256_v1",
        "--identity-email-key-id <id> --identity-email-normalization-version <n>",
        "--json",
      ],
      [
        ...sourceScope,
        "--operation-id <uuid>",
        "--candidate-artifact-file <csv-file>",
        "--identity-set-artifact-file <csv-file>",
        "--schema-version <version> --normalization-version <version>",
        "--identity-fingerprint-version tenant_hmac_sha256_v1",
        "--identity-email-key-id <id> --identity-email-normalization-version <n>",
        "--json",
      ],
    ],
    detail:
      "Starts one exact candidate-scoped GET-only acquisition. Strict candidate JSON or the exact frozen CSV pair is transported without being echoed; only Core derives tenant-HMAC fingerprints. A lost response is never mutation-retried; read the same operation when its manifest guard is known, otherwise stop.",
  },
  {
    command: ["provider-evidence", "resend", "read"],
    usage: [[...scope, "--operation-id <uuid> --json"]],
    detail:
      "Reads aggregate operation progress. Read this before every advance or recovery decision.",
  },
  {
    command: ["provider-evidence", "resend", "advance"],
    usage: [
      [...scope, "--operation-id <uuid> --expected-request-number <n> --json"],
    ],
    detail:
      "Advances exactly one logical GET request using the request number from the latest valid read. A lost response stays unknown; run the exact read command in next_action and never retry the mutation.",
  },
  {
    command: ["provider-evidence", "resend", "seal"],
    usage: [[...scope, "--operation-id <uuid> --generation-id <uuid> --json"]],
    detail:
      "Seals the ready operation under one frozen generation identity without provider or contact mutation authority. A lost response stays unknown; run the exact generation read in next_action and never retry the mutation.",
  },
  {
    command: ["provider-evidence", "resend", "generation", "read"],
    usage: [[...scope, "--generation-id <uuid> --json"]],
    detail:
      "Reads the immutable aggregate generation receipt and its coverage and seal checksums.",
  },
];
