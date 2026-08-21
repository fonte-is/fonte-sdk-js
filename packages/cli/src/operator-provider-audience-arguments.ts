import {
  boundedText,
  idempotencyKey,
  invalidProductionArguments,
  operatorArguments,
  parseProductionOptions,
  positiveInteger,
  required,
  uuid,
  workspace,
  type ProductionOptions,
} from "./operator-production-options.js";
import type {
  ProviderAudienceProvider,
  ProviderCollectionReferenceInput,
} from "./operator-provider-audience-types.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

const referenceNames = [
  "--source-provider",
  "--source-connection-id",
  "--source-collection-id",
  "--source-display-name",
  "--max-age-seconds",
] as const;
const exclusionNames = [
  "--exclude-provider",
  "--exclude-connection-id",
  "--exclude-collection-id",
  "--exclude-display-name",
] as const;

export function parseProviderAudienceArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "bridge") return null;
  if (argv[1] === "collections") return collections(argv.slice(2));
  if (argv[1] === "reconcile") return reconcile(argv.slice(2));
  if (argv[1] === "freeze") return freeze(argv.slice(2));
  return null;
}

function collections(argv: readonly string[]): ParsedOperatorArguments {
  const selectedProvider = provider(argv[0], "provider");
  const options = parseProductionOptions(argv.slice(1), [
    "--workspace",
    "--environment",
    "--connection-id",
  ]);
  return operatorArguments(options, {
    kind: "bridge_provider_collections",
    workspace: workspace(options),
    environment: environment(options),
    provider: selectedProvider,
    connectionId: uuid(required(options, "--connection-id"), "--connection-id"),
  });
}

function reconcile(argv: readonly string[]): ParsedOperatorArguments {
  const options = audienceOptions(argv);
  return operatorArguments(options, {
    kind: "bridge_provider_reconcile",
    workspace: workspace(options),
    environment: environment(options),
    source: source(options),
    exclusions: exclusions(options),
  });
}

function freeze(argv: readonly string[]): ParsedOperatorArguments {
  const options = audienceOptions(argv, ["--fingerprint", "--idempotency-key"]);
  const key = idempotencyKey(required(options, "--idempotency-key"));
  if (key.length > 120) {
    invalidProductionArguments("invalid_field", "--idempotency-key");
  }
  const fingerprint = required(options, "--fingerprint");
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    invalidProductionArguments("invalid_field", "--fingerprint");
  }
  return operatorArguments(options, {
    kind: "bridge_provider_freeze",
    workspace: workspace(options),
    environment: environment(options),
    source: source(options),
    exclusions: exclusions(options),
    expectedObservationFingerprint: fingerprint,
    idempotencyKey: key,
  });
}

function audienceOptions(
  argv: readonly string[],
  extraNames: readonly string[] = [],
): ProductionOptions {
  return parseProductionOptions(
    argv,
    ["--workspace", "--environment", ...referenceNames, ...extraNames],
    exclusionNames,
  );
}

function source(options: ProductionOptions): ProviderCollectionReferenceInput {
  return reference(
    required(options, "--source-provider"),
    required(options, "--source-connection-id"),
    required(options, "--source-collection-id"),
    required(options, "--source-display-name"),
    maxAgeSeconds(options),
    "--source",
  );
}

function exclusions(
  options: ProductionOptions,
): readonly ProviderCollectionReferenceInput[] {
  const values = exclusionNames.map((name) => options.repeated.get(name) ?? []);
  const size = values[0]!.length;
  if (values.some((items) => items.length !== size) || size > 20) {
    invalidProductionArguments("invalid_field", "--exclude-provider");
  }
  return Array.from({ length: size }, (_, index) =>
    reference(
      values[0]![index]!,
      values[1]![index]!,
      values[2]![index]!,
      values[3]![index]!,
      maxAgeSeconds(options),
      "--exclude",
    ),
  );
}

function reference(
  providerValue: string,
  connectionId: string,
  collectionIdValue: string,
  displayNameValue: string,
  maxAgeSeconds: number,
  field: string,
): ProviderCollectionReferenceInput {
  const selected = provider(providerValue, `${field}-provider`);
  const collectionId = nonempty(
    collectionIdValue,
    500,
    `${field}-collection-id`,
  );
  if (selected === "kit" && !/^[1-9]\d{0,18}$/.test(collectionId)) {
    invalidProductionArguments("invalid_field", `${field}-collection-id`);
  }
  const common = {
    connectionId: uuid(connectionId, `${field}-connection-id`),
    collectionId,
    displayName: nonempty(displayNameValue, 200, `${field}-display-name`),
    observationRequirements: {
      completeness: "complete" as const,
      maxAgeSeconds,
    },
  };
  return selected === "resend"
    ? { ...common, provider: "resend", collectionType: "segment" }
    : { ...common, provider: "kit", collectionType: "tag" };
}

function environment(options: ProductionOptions): "sandbox" | "production" {
  const value = required(options, "--environment");
  if (value !== "sandbox" && value !== "production") {
    invalidProductionArguments("invalid_field", "--environment");
  }
  return value;
}

function provider(
  value: string | undefined,
  field: string,
): ProviderAudienceProvider {
  if (value !== "resend" && value !== "kit") {
    invalidProductionArguments(
      value ? "invalid_field" : "missing_field",
      field,
    );
  }
  return value;
}

function maxAgeSeconds(options: ProductionOptions): number {
  const value = positiveInteger(
    required(options, "--max-age-seconds"),
    "--max-age-seconds",
  );
  if (value > 86_400) {
    invalidProductionArguments("invalid_field", "--max-age-seconds");
  }
  return value;
}

function nonempty(value: string, maximum: number, field: string): string {
  const result = boundedText(value, maximum, field);
  if (!result) invalidProductionArguments("invalid_field", field);
  return result;
}
