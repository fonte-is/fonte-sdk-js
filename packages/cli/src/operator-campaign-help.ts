export const CAMPAIGN_OPERATOR_HELP = [
  "fonte campaign list --workspace <slug> --environment <sandbox|production> [--limit <1..50>] [--cursor <value>] [--include-archived <true|false>] [--json]",
  "fonte campaign read --workspace <slug> --environment <sandbox|production> --campaign-id <uuid> [--json]",
  "fonte campaign create --workspace <slug> --environment <sandbox|production> --campaign-id <uuid> --operation-id <uuid> --title <text> [--description <text>] [--json]",
  "fonte campaign update --workspace <slug> --environment <sandbox|production> --campaign-id <uuid> --operation-id <uuid> --expected-revision <n> --title <text> --description <text> --archived <true|false> [--json]",
  "fonte campaign receipt --workspace <slug> --environment <sandbox|production> --operation-id <uuid> [--json]",
].join("\n");
