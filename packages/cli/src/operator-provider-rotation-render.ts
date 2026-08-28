import type { OperatorReceipt } from "./operator-types.js";
import type {
  ProviderRotationResult,
  ProviderRotationSelectorResult,
} from "./operator-provider-rotation-types.js";

export function renderProviderRotation(
  receipt: OperatorReceipt,
  result: ProviderRotationResult,
): string {
  const population = result.population;
  const partition = result.partition;
  return [
    `Fonte Bridge rotation: ${result.status}.`,
    `Iteration: ${result.iterationId}.`,
    `Population: ${population ? `${population.count} (${population.rootSha256})` : "pending"}.`,
    `Population artifact/manifest: ${population ? `${population.artifactSha256}/${population.candidateManifestSha256}` : "pending"}.`,
    `Population convergence/page/cursor: ${result.populationProgress.convergencePass}/${result.populationProgress.nextPageNumber}/${cursor(result.populationProgress)}.`,
    `Population pages/calls/retries/throttles: ${counters(result.populationProgress)}.`,
    `Broadcast next ordinal/stage/cursor: ${result.broadcastProgress.nextBroadcastOrdinal ?? "complete"}/${result.broadcastProgress.nextStage ?? "complete"}/${cursor(result.broadcastProgress)}.`,
    `Broadcast pages/calls/retries/throttles: ${counters(result.broadcastProgress)}.`,
    `Broadcast evidence checksum: ${result.broadcastEvidence?.evidenceChecksumSha256 ?? "pending"}.`,
    `Partition E/W/X/U: ${partition ? categoryCounts(partition.counts) : "pending"}.`,
    `Partition reasons: ${partition ? reasons(partition.reasonCounts) : "pending"}.`,
    `Partition selectors: ${partition ? selectors(partition.selectors) : "pending"}.`,
    `Outgoing/cold remaining: ${partition ? `${partition.outgoingCount}/${partition.coldRemaining}` : `pending/${result.coldRemaining}`}.`,
    `Outgoing selector: ${partition?.outgoing ? selector(partition.outgoing) : partition ? "blocked-or-empty" : "pending"}.`,
    `Partition union/checksum: ${partition ? `${partition.unionConservationSha256}/${partition.partitionChecksumSha256}` : "pending"}.`,
    `Candidate/partition generations: ${result.candidateGenerationId ?? "pending"}/${result.partitionGenerationId ?? "pending"}.`,
    `Authority: stored-credential ${result.authority.providerAccess}; provider mutation ${result.authority.providerMutation}; unknown allows effect ${result.authority.unknownAllowsEffect}.`,
    `Core effect: ${receipt.core_effect}.`,
    "",
  ].join("\n");
}

function counters(value: {
  readonly pages: number;
  readonly providerCalls: number;
  readonly providerRetries: number;
  readonly providerThrottles: number;
}): string {
  return [
    value.pages,
    value.providerCalls,
    value.providerRetries,
    value.providerThrottles,
  ].join("/");
}

function cursor(value: {
  readonly nextCursorPresent: boolean;
  readonly nextCursorChecksumSha256: string | null;
}): string {
  return value.nextCursorPresent
    ? (value.nextCursorChecksumSha256 ?? "invalid")
    : "none";
}

function categoryCounts(
  counts: Readonly<Record<"E" | "W" | "X" | "U", number>>,
): string {
  return `${counts.E}/${counts.W}/${counts.X}/${counts.U}`;
}

function reasons(
  values: readonly {
    readonly category: "E" | "W" | "X" | "U";
    readonly reason: string;
    readonly count: number;
  }[],
): string {
  return values.length === 0
    ? "none"
    : values
        .map((value) => `${value.category}:${value.reason}=${value.count}`)
        .join(", ");
}

function selectors(
  values: NonNullable<ProviderRotationResult["partition"]>["selectors"],
): string {
  return (["E", "W", "X", "U"] as const)
    .map((category) => `${category}=${selector(values[category])}`)
    .join(", ");
}

function selector(value: ProviderRotationSelectorResult): string {
  return `${value.selectorId}/${value.selectorGenerationId}/${value.candidateCount}/${value.identitySetSha256}/${value.candidateManifestSha256}`;
}
