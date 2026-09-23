export const SEGMENT_OPERATOR_HELP = [
  "fonte segment list --workspace <slug> --environment <sandbox|production> [--limit <1..50>] [--cursor <value>] [--include-archived <true|false>] [--json]",
  "fonte segment read --workspace <slug> --environment <sandbox|production> --segment-id <uuid> [--revision <n>] [--json]",
  "fonte segment create --workspace <slug> --environment <sandbox|production> --segment-id <uuid> --operation-id <uuid> --title <text> --rule <json|-> [--json]",
  "fonte segment update --workspace <slug> --environment <sandbox|production> --segment-id <uuid> --operation-id <uuid> --expected-revision <n> --title <text> --rule <json|-> [--json]",
  "fonte segment archive --workspace <slug> --environment <sandbox|production> --segment-id <uuid> --operation-id <uuid> --expected-revision <n> [--json]",
  "fonte segment restore --workspace <slug> --environment <sandbox|production> --segment-id <uuid> --operation-id <uuid> --expected-revision <n> [--json]",
  "fonte segment receipt --workspace <slug> --environment <sandbox|production> --operation-id <uuid> [--json]",
].join("\n");
