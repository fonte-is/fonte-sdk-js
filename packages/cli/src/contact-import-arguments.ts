import {
  invalidProductionArguments,
  operatorArguments,
  parseProductionOptions,
  required,
  uuid,
  workspace,
} from "./operator-production-options.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

export function parseContactImportArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "bridge" || argv[1] !== "import" || argv[2] !== "status")
    return null;
  const options = parseProductionOptions(argv.slice(3), [
    "--workspace",
    "--environment",
    "--contact-import-batch-id",
  ]);
  const environment = required(options, "--environment");
  if (environment !== "sandbox" && environment !== "production")
    invalidProductionArguments();
  return operatorArguments(options, {
    kind: "bridge_contact_import_status",
    workspace: workspace(options),
    environment,
    contactImportBatchId: uuid(
      required(options, "--contact-import-batch-id"),
      "--contact-import-batch-id",
    ),
  });
}
