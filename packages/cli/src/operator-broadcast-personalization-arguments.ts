import type { ParsedOperatorArguments } from "./operator-types.js";
import { parseProductionOptions, workspace, required, uuid, positiveInteger,
  invalidProductionArguments } from "./operator-production-options.js";

export function parseBroadcastPersonalizationArguments(argv: readonly string[]): ParsedOperatorArguments | null {
  if (argv[0] !== "broadcast" || argv[1] !== "personalization") return null;
  const action = argv[2];
  if (action !== "schema" && action !== "preview") invalidProductionArguments("invalid_field", "command");
  const options = parseProductionOptions(argv.slice(3), ["--workspace", "--environment",
    ...(action === "preview" ? ["--draft-id", "--revision", "--schema-version", "--sample", "--contact-id", "--recipient-email"] : [])]);
  const environment = required(options, "--environment");
  if (environment !== "production" && environment !== "sandbox") invalidProductionArguments("invalid_field", "--environment");
  const scope = { workspace: workspace(options), environment } as const;
  if (action === "schema") return { command: { kind: "broadcast_personalization_schema", ...scope }, json: options.json };
  const sample = required(options, "--sample");
  if (sample !== "missing" && sample !== "selected") invalidProductionArguments("invalid_field", "--sample");
  if (sample === "missing" && (options.values.has("--contact-id") || options.values.has("--recipient-email"))) {
    invalidProductionArguments("invalid_field", "--sample");
  }
  return { command: { kind: "broadcast_personalization_preview", ...scope,
    draftId: uuid(required(options, "--draft-id")), revision: positiveInteger(required(options, "--revision")),
    schemaVersion: required(options, "--schema-version"), sample: sample === "missing" ? { kind: "synthetic_missing" } : {
      kind: "selected_contact", contactId: required(options, "--contact-id"), recipientEmail: required(options, "--recipient-email") } },
    json: options.json };
}
