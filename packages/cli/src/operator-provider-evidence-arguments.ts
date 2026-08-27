import { CliUsageError } from "./errors.js";
import type { ParsedOperatorArguments } from "./operator-types.js";
import type {
  ProviderEvidenceCandidateSelector,
  ProviderEvidenceOperatorCommand,
} from "./operator-provider-evidence-types.js";

const COMMON = [
  "--workspace",
  "--environment",
  "--connection-id",
  "--selector-id",
  "--selector-generation-id",
  "--artifact-sha256",
  "--identity-set-sha256",
  "--candidate-count",
  "--candidate-manifest-sha256",
] as const;

export function parseProviderEvidenceArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "provider-evidence") return null;
  if (argv[1] !== "resend") invalidCommand();
  const command = argv[2];
  if (command === "start") return start(argv.slice(3));
  if (command === "read") return operation("read", argv.slice(3));
  if (command === "advance") return operation("advance", argv.slice(3));
  if (command === "seal") return operation("seal", argv.slice(3));
  if (command === "generation" && argv[3] === "read") {
    return generationRead(argv.slice(4));
  }
  return invalidCommand();
}

function start(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseOptions(argv, [
    ...COMMON,
    "--operation-id",
    "--candidates-file",
    "--schema-version",
    "--normalization-version",
    "--identity-fingerprint-version",
    "--identity-email-key-id",
    "--identity-email-normalization-version",
  ]);
  return result({
    kind: "provider_evidence_candidate_start",
    ...scope(options),
    operationId: uuid(options, "--operation-id"),
    candidatesFile: bounded(options, "--candidates-file", 4_096),
    schemaVersion: version(options, "--schema-version"),
    normalizationVersion: version(options, "--normalization-version"),
    identityFingerprintVersion: fingerprintVersion(options),
    identityCustody: {
      emailAddressKeyId: bounded(options, "--identity-email-key-id", 200),
      emailNormalizationVersion: positiveInteger(
        options,
        "--identity-email-normalization-version",
      ),
    },
  });
}

function operation(
  kind: "read" | "advance" | "seal",
  argv: readonly string[],
): ParsedOperatorArguments {
  const extra =
    kind === "advance"
      ? ["--expected-request-number"]
      : kind === "seal"
        ? ["--generation-id"]
        : [];
  const options = parseOptions(argv, [...COMMON, "--operation-id", ...extra]);
  const base = {
    ...scope(options),
    operationId: uuid(options, "--operation-id"),
  };
  if (kind === "advance") {
    return result({
      kind: "provider_evidence_candidate_advance",
      ...base,
      expectedRequestNumber: positiveInteger(
        options,
        "--expected-request-number",
      ),
    });
  }
  if (kind === "seal") {
    return result({
      kind: "provider_evidence_candidate_seal",
      ...base,
      generationId: uuid(options, "--generation-id"),
    });
  }
  return result({ kind: "provider_evidence_candidate_read", ...base });
}

function generationRead(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseOptions(argv, [...COMMON, "--generation-id"]);
  return result({
    kind: "provider_evidence_candidate_generation_read",
    ...scope(options),
    generationId: uuid(options, "--generation-id"),
  });
}

function result(
  command: ProviderEvidenceOperatorCommand,
): ParsedOperatorArguments {
  return { command, json: true };
}

function scope(options: Options) {
  return {
    workspace: workspace(options),
    environment: environment(options),
    connectionId: uuid(options, "--connection-id"),
    selector: selector(options),
  };
}

function selector(options: Options): ProviderEvidenceCandidateSelector {
  return {
    selectorId: bounded(options, "--selector-id", 500),
    selectorGenerationId: uuid(options, "--selector-generation-id"),
    artifactSha256: sha256(options, "--artifact-sha256"),
    identitySetSha256: sha256(options, "--identity-set-sha256"),
    candidateCount: positiveInteger(options, "--candidate-count"),
    candidateManifestSha256: sha256(options, "--candidate-manifest-sha256"),
  };
}

interface Options {
  readonly values: ReadonlyMap<string, string>;
}

function parseOptions(
  argv: readonly string[],
  valueNames: readonly string[],
): Options {
  const allowed = new Set(valueNames);
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--json" && !json) {
      json = true;
      continue;
    }
    if (!allowed.has(name) || values.has(name)) invalid();
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || value.includes("\0")) invalid();
    values.set(name, value);
    index += 1;
  }
  if (!json) missing("--json");
  for (const name of valueNames) if (!values.has(name)) missing(name);
  return { values };
}

function workspace(options: Options): string {
  const value = required(options, "--workspace");
  if (
    value.length < 2 ||
    value.length > 63 ||
    value.includes("--") ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(value)
  )
    invalid();
  return value;
}

function environment(options: Options): "sandbox" | "production" {
  const value = required(options, "--environment");
  if (value !== "sandbox" && value !== "production") invalid();
  return value;
}

function uuid(options: Options, name: string): string {
  const value = required(options, name);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) invalid();
  return value;
}

function sha256(options: Options, name: string): string {
  const value = required(options, name);
  if (!/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}

function positiveInteger(options: Options, name: string): number {
  const value = required(options, name);
  if (!/^[1-9]\d*$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) invalid();
  return parsed;
}

function bounded(options: Options, name: string, maximum: number): string {
  const value = required(options, name);
  if (
    value !== value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function version(options: Options, name: string): string {
  const value = bounded(options, name, 100);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) invalid();
  return value;
}

function fingerprintVersion(options: Options): "tenant_hmac_sha256_v1" {
  const value = required(options, "--identity-fingerprint-version");
  if (value !== "tenant_hmac_sha256_v1") invalid();
  return value;
}

function required(options: Options, name: string): string {
  const value = options.values.get(name);
  if (!value) missing(name);
  return value;
}

function missing(field: string): never {
  throw new CliUsageError("invalid_operator_arguments", {
    kind: "missing_field",
    field,
  });
}

function invalid(): never {
  throw new CliUsageError("invalid_operator_arguments");
}

function invalidCommand(): never {
  throw new CliUsageError("invalid_operator_command");
}
