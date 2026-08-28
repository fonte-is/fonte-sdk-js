import {
  boundedText,
  invalidProductionArguments,
  operatorArguments,
  parseProductionOptions,
  positiveInteger,
  required,
  uuid,
  workspace,
  type ProductionOptions,
} from "./operator-production-options.js";
import type { ParsedOperatorArguments } from "./operator-types.js";

export function parseProviderRotationArguments(
  argv: readonly string[],
): ParsedOperatorArguments | null {
  if (argv[0] !== "bridge" || argv[1] !== "rotation") return null;
  if (argv[2] === "start") return start(argv.slice(3));
  if (argv[2] === "advance") return advance(argv.slice(3));
  if (argv[2] === "read") return read(argv.slice(3));
  if (argv[2] === "seal") return seal(argv.slice(3));
  return null;
}

function start(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseProductionOptions(
    argv,
    [
      "--workspace",
      "--environment",
      "--iteration-id",
      "--connection-id",
      "--candidate-operation-id",
      "--outgoing-candidate-operation-id",
      "--population-selector-generation-id",
      "--placement-segment-id",
      "--qualifying-broadcast-id",
      "--cold-remaining",
      "--identity-key-id",
      "--identity-normalization-version",
    ],
    ["--ordered-broadcast-id"],
  );
  const scope = base(options);
  const connectionId = uuid(
    required(options, "--connection-id"),
    "--connection-id",
  );
  const candidateOperationId = uuid(
    required(options, "--candidate-operation-id"),
    "--candidate-operation-id",
  );
  const outgoingCandidateOperationId = uuid(
    required(options, "--outgoing-candidate-operation-id"),
    "--outgoing-candidate-operation-id",
  );
  const populationSelectorGenerationId = uuid(
    required(options, "--population-selector-generation-id"),
    "--population-selector-generation-id",
  );
  if (
    new Set([
      scope.iterationId,
      candidateOperationId,
      outgoingCandidateOperationId,
      populationSelectorGenerationId,
    ]).size !== 4
  ) {
    invalidProductionArguments("invalid_field", "--iteration-id");
  }
  return operatorArguments(options, {
    kind: "bridge_provider_rotation_start",
    ...scope,
    connectionId,
    candidateOperationId,
    outgoingCandidateOperationId,
    populationSelectorGenerationId,
    placementSegmentId: uuid(
      required(options, "--placement-segment-id"),
      "--placement-segment-id",
    ),
    ...broadcasts(options),
    coldRemaining: nonnegative(
      required(options, "--cold-remaining"),
      "--cold-remaining",
    ),
    identityCustody: {
      emailAddressKeyId: boundedText(
        required(options, "--identity-key-id"),
        200,
        "--identity-key-id",
      ),
      emailNormalizationVersion: positiveInteger(
        required(options, "--identity-normalization-version"),
        "--identity-normalization-version",
      ),
    },
  });
}

function advance(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseProductionOptions(argv, [
    "--workspace",
    "--environment",
    "--iteration-id",
    "--expected-page-number",
  ]);
  return operatorArguments(options, {
    kind: "bridge_provider_rotation_advance",
    ...base(options),
    expectedPageNumber: positiveInteger(
      required(options, "--expected-page-number"),
      "--expected-page-number",
    ),
  });
}

function read(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseProductionOptions(argv, [
    "--workspace",
    "--environment",
    "--iteration-id",
  ]);
  return operatorArguments(options, {
    kind: "bridge_provider_rotation_read",
    ...base(options),
  });
}

function seal(argv: readonly string[]): ParsedOperatorArguments {
  const options = parseProductionOptions(
    argv,
    [
      "--workspace",
      "--environment",
      "--iteration-id",
      "--candidate-generation-id",
      "--partition-generation-id",
      "--qualifying-broadcast-id",
    ],
    ["--ordered-broadcast-id"],
  );
  const selected = broadcasts(options);
  return operatorArguments(options, {
    kind: "bridge_provider_rotation_seal",
    ...base(options),
    candidateGenerationId: uuid(
      required(options, "--candidate-generation-id"),
      "--candidate-generation-id",
    ),
    partitionGenerationId: uuid(
      required(options, "--partition-generation-id"),
      "--partition-generation-id",
    ),
    ...selected,
  });
}

function broadcasts(options: ProductionOptions): {
  readonly qualifyingBroadcastId: string;
  readonly orderedBroadcastIds: readonly string[];
} {
  const orderedBroadcastIds = (
    options.repeated.get("--ordered-broadcast-id") ?? []
  ).map((value) => uuid(value, "--ordered-broadcast-id"));
  if (
    orderedBroadcastIds.length < 1 ||
    orderedBroadcastIds.length > 4 ||
    new Set(orderedBroadcastIds).size !== orderedBroadcastIds.length
  ) {
    invalidProductionArguments("invalid_field", "--ordered-broadcast-id");
  }
  const qualifyingBroadcastId = uuid(
    required(options, "--qualifying-broadcast-id"),
    "--qualifying-broadcast-id",
  );
  if (!orderedBroadcastIds.includes(qualifyingBroadcastId)) {
    invalidProductionArguments("invalid_field", "--qualifying-broadcast-id");
  }
  return { qualifyingBroadcastId, orderedBroadcastIds };
}

function base(options: ProductionOptions): {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly iterationId: string;
} {
  const selectedEnvironment = required(options, "--environment");
  if (
    selectedEnvironment !== "sandbox" &&
    selectedEnvironment !== "production"
  ) {
    invalidProductionArguments("invalid_field", "--environment");
  }
  return {
    workspace: workspace(options),
    environment: selectedEnvironment,
    iterationId: uuid(required(options, "--iteration-id"), "--iteration-id"),
  };
}

function nonnegative(value: string, field: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    invalidProductionArguments("invalid_field", field);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    invalidProductionArguments("invalid_field", field);
  return result;
}
