import {
  boundedText,
  invalidProductionArguments,
  operatorArguments,
  parseProductionOptions,
  positiveInteger,
  required,
  uuid,
  workspace,
} from "./operator-production-options.js";
import type { ParsedOperatorArguments } from "./operator-types.js";
import type { ProviderConnectionProvider } from "./operator-provider-connection-types.js";

export function parseProviderConnectionArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "bridge" || argv[1] !== "connections") return null;
  const operation = argv[2];
  const selectedProvider = provider(argv[3]);
  const rest = argv.slice(4);
  if (operation === "list") {
    const options = parseProductionOptions(rest, [
      "--workspace",
      "--environment",
    ]);
    return operatorArguments(options, {
      kind: "bridge_connection_list",
      workspace: workspace(options),
      environment: environment(options),
      provider: selectedProvider,
    });
  }
  if (operation === "connect") {
    const options = parseProductionOptions(rest, [
      "--workspace",
      "--environment",
      "--display-name",
    ]);
    return operatorArguments(options, {
      kind: "bridge_connection_connect",
      workspace: workspace(options),
      environment: environment(options),
      provider: selectedProvider,
      displayName: displayName(options),
    });
  }
  if (operation === "reconnect") {
    const options = parseProductionOptions(rest, [
      "--workspace",
      "--environment",
      "--connection-id",
      "--display-name",
      "--expected-credential-version",
    ]);
    return operatorArguments(options, {
      kind: "bridge_connection_reconnect",
      workspace: workspace(options),
      environment: environment(options),
      provider: selectedProvider,
      connectionId: uuid(
        required(options, "--connection-id"),
        "--connection-id",
      ),
      displayName: displayName(options),
      expectedCredentialVersion: positiveInteger(
        required(options, "--expected-credential-version"),
        "--expected-credential-version",
      ),
    });
  }
  invalidProductionArguments("invalid_field", "connections operation");
}

function provider(value: string | undefined): ProviderConnectionProvider {
  if (value !== "resend" && value !== "kit") {
    invalidProductionArguments(
      value ? "invalid_field" : "missing_field",
      "provider",
    );
  }
  return value;
}

function environment(options: ReturnType<typeof parseProductionOptions>) {
  const value = required(options, "--environment");
  if (value !== "sandbox" && value !== "production") {
    invalidProductionArguments("invalid_field", "--environment");
  }
  return value;
}

function displayName(
  options: ReturnType<typeof parseProductionOptions>,
): string {
  const value = boundedText(
    required(options, "--display-name"),
    100,
    "--display-name",
  );
  if (!value) invalidProductionArguments("invalid_field", "--display-name");
  return value;
}
