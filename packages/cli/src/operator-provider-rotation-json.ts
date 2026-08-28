import type {
  ProviderRotationReason,
  ProviderRotationResult,
  ProviderRotationSelectorResult,
} from "./operator-provider-rotation-types.js";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function providerRotationReceipt(
  value: unknown,
): ProviderRotationResult {
  const body = exact(value, [
    "schemaVersion",
    "orderingVersion",
    "authority",
    "iterationId",
    "workspaceId",
    "environment",
    "connectionId",
    "placementSegmentId",
    "credentialVersion",
    "status",
    "populationProgress",
    "population",
    "broadcastProgress",
    "broadcastEvidence",
    "candidateAcquisition",
    "outgoingCandidateAcquisition",
    "outgoingIntake",
    "coldRemaining",
    "partition",
    "candidateGenerationId",
    "partitionGenerationId",
  ]);
  if (
    body.schemaVersion !== "provider_rotation_partition.v1" ||
    body.orderingVersion !== "provider_rotation_engagement_created_email.v1" ||
    !rotationStatus(body.status)
  )
    invalid();
  const authority = exact(body.authority, [
    "provider",
    "providerAccess",
    "providerMutation",
    "unknownAllowsEffect",
  ]);
  if (
    authority.provider !== "resend" ||
    authority.providerAccess !== "get_only_stored_credential" ||
    authority.providerMutation !== "not_granted" ||
    authority.unknownAllowsEffect !== false
  )
    invalid();
  const progress = progressValue(body.populationProgress);
  const population =
    body.population === null ? null : populationValue(body.population);
  const broadcastProgress = broadcastProgressValue(body.broadcastProgress);
  const broadcastEvidence =
    body.broadcastEvidence === null
      ? null
      : broadcastEvidenceValue(body.broadcastEvidence, broadcastProgress);
  const acquisition =
    body.candidateAcquisition === null
      ? null
      : acquisitionValue(body.candidateAcquisition);
  const outgoingAcquisition =
    body.outgoingCandidateAcquisition === null
      ? null
      : acquisitionValue(body.outgoingCandidateAcquisition);
  const outgoingIntake =
    body.outgoingIntake === null ? null : intakeValue(body.outgoingIntake);
  const partition =
    body.partition === null ? null : partitionValue(body.partition);
  const result = {
    kind: "provider_rotation_partition" as const,
    schemaVersion: body.schemaVersion,
    orderingVersion: body.orderingVersion,
    authority: authority as unknown as ProviderRotationResult["authority"],
    iterationId: uuid(body.iterationId),
    workspaceId: text(body.workspaceId, 500),
    environment: environment(body.environment),
    connectionId: uuid(body.connectionId),
    placementSegmentId: uuid(body.placementSegmentId),
    credentialVersion: positive(body.credentialVersion),
    status: body.status,
    populationProgress: progress,
    population,
    broadcastProgress,
    broadcastEvidence,
    candidateAcquisition: acquisition,
    outgoingCandidateAcquisition: outgoingAcquisition,
    outgoingIntake,
    coldRemaining: nonnegative(body.coldRemaining),
    partition,
    candidateGenerationId: nullableUuid(body.candidateGenerationId),
    partitionGenerationId: nullableUuid(body.partitionGenerationId),
  } satisfies ProviderRotationResult;
  if (
    population &&
    acquisition &&
    (population.count !== acquisition.candidateCount ||
      population.selectorGenerationId !== acquisition.selectorGenerationId ||
      population.rootSha256 !== acquisition.identitySetSha256 ||
      population.artifactSha256 !== acquisition.artifactSha256 ||
      population.candidateManifestSha256 !==
        acquisition.candidateManifestSha256)
  )
    invalid();
  const terminal =
    result.status === "complete" || result.status === "blocked_unknown";
  if (
    terminal !== (partition !== null) ||
    terminal !== (result.candidateGenerationId !== null) ||
    terminal !== (result.partitionGenerationId !== null) ||
    (result.status === "acquiring_broadcasts" ||
      result.status === "acquiring_evidence") !==
      (acquisition !== null && !terminal) ||
    (terminal && (!population || !acquisition)) ||
    (result.status === "acquiring_evidence" || terminal) !==
      (broadcastEvidence !== null) ||
    (partition === null && outgoingIntake !== null) ||
    (partition !== null &&
      (partition.outgoing === null) !== (outgoingIntake === null)) ||
    (outgoingIntake !== null &&
      (!outgoingAcquisition ||
        outgoingIntake.count !== outgoingAcquisition.candidateCount ||
        !sameSelector(outgoingIntake.selector, outgoingAcquisition))) ||
    (result.status === "acquiring_broadcasts" &&
      broadcastProgress.nextStage === null) ||
    (result.status === "population_ready" && !population) ||
    (result.status === "population_changed" && population !== null)
  )
    invalid();
  if (
    partition &&
    population &&
    (partition.populationCount !== population.count ||
      partition.populationRootSha256 !== population.rootSha256 ||
      partition.coldRemaining !== result.coldRemaining ||
      partition.unionConservationSha256 !== population.rootSha256 ||
      sum(Object.values(partition.counts)) !== population.count ||
      (partition.status === "blocked_unknown") !== partition.counts.U > 0 ||
      partition.outgoingCount !==
        (partition.status === "blocked_unknown"
          ? 0
          : Math.min(partition.counts.E, partition.coldRemaining)) ||
      (partition.outgoing === null) !== (partition.outgoingCount === 0) ||
      (partition.outgoing &&
        partition.outgoing.candidateCount !== partition.outgoingCount) ||
      (partition.outgoing === null) !== (outgoingAcquisition === null) ||
      (partition.outgoing &&
        outgoingAcquisition &&
        !sameSelector(partition.outgoing, outgoingAcquisition)))
  )
    invalid();
  return result;
}

function broadcastProgressValue(
  value: unknown,
): ProviderRotationResult["broadcastProgress"] {
  const row = exact(value, [
    "qualifyingBroadcastId",
    "orderedBroadcastIds",
    "nextBroadcastOrdinal",
    "nextStage",
    "nextCursorPresent",
    "nextCursorChecksumSha256",
    "pages",
    "providerCalls",
    "providerRetries",
    "providerThrottles",
  ]);
  if (!Array.isArray(row.orderedBroadcastIds)) invalid();
  const orderedBroadcastIds = row.orderedBroadcastIds.map(uuid);
  const qualifyingBroadcastId = uuid(row.qualifyingBroadcastId);
  const pages = nonnegative(row.pages);
  const calls = nonnegative(row.providerCalls);
  const retries = nonnegative(row.providerRetries);
  const throttles = nonnegative(row.providerThrottles);
  const nextStage = row.nextStage;
  if (
    orderedBroadcastIds.length < 1 ||
    orderedBroadcastIds.length > 4 ||
    new Set(orderedBroadcastIds).size !== orderedBroadcastIds.length ||
    !orderedBroadcastIds.includes(qualifyingBroadcastId) ||
    (nextStage !== null &&
      nextStage !== "metadata" &&
      nextStage !== "accepted" &&
      nextStage !== "delivered" &&
      nextStage !== "opened" &&
      nextStage !== "clicked") ||
    (row.nextBroadcastOrdinal !== null &&
      positive(row.nextBroadcastOrdinal) > orderedBroadcastIds.length) ||
    (row.nextBroadcastOrdinal === null) !== (nextStage === null) ||
    typeof row.nextCursorPresent !== "boolean" ||
    row.nextCursorPresent !== (row.nextCursorChecksumSha256 !== null) ||
    (row.nextCursorChecksumSha256 !== null &&
      !sha(row.nextCursorChecksumSha256)) ||
    retries !== calls - pages ||
    throttles > retries
  ) {
    invalid();
  }
  return {
    qualifyingBroadcastId,
    orderedBroadcastIds,
    nextBroadcastOrdinal: row.nextBroadcastOrdinal as number | null,
    nextStage:
      nextStage as ProviderRotationResult["broadcastProgress"]["nextStage"],
    nextCursorPresent: row.nextCursorPresent,
    nextCursorChecksumSha256: row.nextCursorChecksumSha256 as string | null,
    pages,
    providerCalls: calls,
    providerRetries: retries,
    providerThrottles: throttles,
  };
}

function broadcastEvidenceValue(
  value: unknown,
  progress: ProviderRotationResult["broadcastProgress"],
): NonNullable<ProviderRotationResult["broadcastEvidence"]> {
  const row = exact(value, ["broadcasts", "evidenceChecksumSha256"]);
  if (!Array.isArray(row.broadcasts)) invalid();
  const broadcasts = row.broadcasts.map((value) => {
    const broadcast = exact(value, ["broadcastId", "sentAt", "outcomes"]);
    const outcomes = exact(broadcast.outcomes, [
      "accepted",
      "delivered",
      "opened",
      "clicked",
    ]);
    return {
      broadcastId: uuid(broadcast.broadcastId),
      sentAt: instant(broadcast.sentAt),
      outcomes: Object.fromEntries(
        (["accepted", "delivered", "opened", "clicked"] as const).map(
          (outcome) => {
            const receipt = exact(outcomes[outcome], [
              "count",
              "identitySetSha256",
            ]);
            return [
              outcome,
              {
                count: nonnegative(receipt.count),
                identitySetSha256: sha(receipt.identitySetSha256),
              },
            ];
          },
        ),
      ) as NonNullable<
        ProviderRotationResult["broadcastEvidence"]
      >["broadcasts"][number]["outcomes"],
    };
  });
  if (
    broadcasts.length !== progress.orderedBroadcastIds.length ||
    broadcasts.some(
      (broadcast, index) =>
        broadcast.broadcastId !== progress.orderedBroadcastIds[index],
    )
  ) {
    invalid();
  }
  return {
    broadcasts,
    evidenceChecksumSha256: sha(row.evidenceChecksumSha256),
  };
}

function progressValue(
  value: unknown,
): ProviderRotationResult["populationProgress"] {
  const row = exact(value, [
    "convergencePass",
    "nextPageNumber",
    "nextCursorPresent",
    "nextCursorChecksumSha256",
    "pages",
    "providerCalls",
    "providerRetries",
    "providerThrottles",
  ]);
  const pages = nonnegative(row.pages);
  const calls = nonnegative(row.providerCalls);
  const retries = nonnegative(row.providerRetries);
  const throttles = nonnegative(row.providerThrottles);
  if (
    (row.convergencePass !== 1 && row.convergencePass !== 2) ||
    typeof row.nextCursorPresent !== "boolean" ||
    row.nextCursorPresent !== (row.nextCursorChecksumSha256 !== null) ||
    (row.nextCursorChecksumSha256 !== null &&
      !sha(row.nextCursorChecksumSha256)) ||
    retries !== calls - pages ||
    throttles > retries
  )
    invalid();
  return {
    convergencePass: row.convergencePass,
    nextPageNumber: positive(row.nextPageNumber),
    nextCursorPresent: row.nextCursorPresent,
    nextCursorChecksumSha256: row.nextCursorChecksumSha256 as string | null,
    pages,
    providerCalls: calls,
    providerRetries: retries,
    providerThrottles: throttles,
  };
}

function populationValue(
  value: unknown,
): NonNullable<ProviderRotationResult["population"]> {
  const row = exact(value, [
    "selectorGenerationId",
    "count",
    "rootSha256",
    "artifactSha256",
    "candidateManifestSha256",
    "observedAt",
  ]);
  const observed = exact(row.observedAt, ["start", "end"]);
  const start = instant(observed.start);
  const end = instant(observed.end);
  if (Date.parse(start) > Date.parse(end)) invalid();
  return {
    selectorGenerationId: uuid(row.selectorGenerationId),
    count: positive(row.count),
    rootSha256: sha(row.rootSha256),
    artifactSha256: sha(row.artifactSha256),
    candidateManifestSha256: sha(row.candidateManifestSha256),
    observedAt: { start, end },
  };
}

function acquisitionValue(
  value: unknown,
): NonNullable<ProviderRotationResult["candidateAcquisition"]> {
  const row = exact(value, [
    "operationId",
    "selectorId",
    "selectorGenerationId",
    "artifactSha256",
    "identitySetSha256",
    "candidateCount",
    "candidateManifestSha256",
  ]);
  return { operationId: uuid(row.operationId), ...selectorValue(row) };
}

function intakeValue(
  value: unknown,
): NonNullable<ProviderRotationResult["outgoingIntake"]> {
  const row = exact(value, [
    "schemaVersion",
    "contactImportBatchId",
    "sourceChecksumSha256",
    "fonteIdentitySetSha256",
    "count",
    "selector",
    "bindingChecksumSha256",
  ]);
  if (row.schemaVersion !== "provider_rotation_intake.v1") invalid();
  return {
    schemaVersion: row.schemaVersion,
    contactImportBatchId: uuid(row.contactImportBatchId),
    sourceChecksumSha256: sha(row.sourceChecksumSha256),
    fonteIdentitySetSha256: sha(row.fonteIdentitySetSha256),
    count: positive(row.count),
    selector: selectorValue(
      exact(row.selector, [
        "selectorId",
        "selectorGenerationId",
        "artifactSha256",
        "identitySetSha256",
        "candidateCount",
        "candidateManifestSha256",
      ]),
    ),
    bindingChecksumSha256: sha(row.bindingChecksumSha256),
  };
}

function partitionValue(
  value: unknown,
): NonNullable<ProviderRotationResult["partition"]> {
  const row = exact(value, [
    "schemaVersion",
    "orderingVersion",
    "status",
    "populationCount",
    "populationRootSha256",
    "counts",
    "reasonCounts",
    "selectors",
    "outgoing",
    "outgoingCount",
    "coldRemaining",
    "unionConservationSha256",
    "partitionChecksumSha256",
  ]);
  if (
    row.schemaVersion !== "provider_rotation_partition.v1" ||
    row.orderingVersion !== "provider_rotation_engagement_created_email.v1" ||
    (row.status !== "complete" && row.status !== "blocked_unknown")
  )
    invalid();
  const counts = categoryCounts(row.counts);
  const selectors = selectorMap(row.selectors);
  if (
    (["E", "W", "X", "U"] as const).some(
      (key) => selectors[key].candidateCount !== counts[key],
    )
  )
    invalid();
  if (!Array.isArray(row.reasonCounts)) invalid();
  const reasonCounts = row.reasonCounts.map((value) => {
    const reason = exact(value, ["category", "reason", "count"]);
    if (!category(reason.category)) invalid();
    return {
      category: reason.category,
      reason: rotationReason(reason.reason),
      count: positive(reason.count),
    };
  });
  const reasonKeys = reasonCounts.map(
    (value) => `${value.category}:${value.reason}`,
  );
  if (
    new Set(reasonKeys).size !== reasonKeys.length ||
    (["E", "W", "X", "U"] as const).some(
      (category) =>
        sum(
          reasonCounts
            .filter((value) => value.category === category)
            .map((value) => value.count),
        ) !== counts[category],
    )
  )
    invalid();
  return {
    schemaVersion: row.schemaVersion,
    orderingVersion: row.orderingVersion,
    status: row.status,
    populationCount: positive(row.populationCount),
    populationRootSha256: sha(row.populationRootSha256),
    counts,
    reasonCounts,
    selectors,
    outgoing:
      row.outgoing === null
        ? null
        : selectorValue(
            exact(row.outgoing, [
              "selectorId",
              "selectorGenerationId",
              "artifactSha256",
              "identitySetSha256",
              "candidateCount",
              "candidateManifestSha256",
            ]),
          ),
    outgoingCount: nonnegative(row.outgoingCount),
    coldRemaining: nonnegative(row.coldRemaining),
    unionConservationSha256: sha(row.unionConservationSha256),
    partitionChecksumSha256: sha(row.partitionChecksumSha256),
  };
}

function selectorMap(
  value: unknown,
): ProviderRotationResult["partition"] extends infer P
  ? P extends { selectors: infer S }
    ? S
    : never
  : never {
  const row = exact(value, ["E", "W", "X", "U"]);
  return Object.fromEntries(
    (["E", "W", "X", "U"] as const).map((key) => [
      key,
      selectorValue(
        exact(row[key], [
          "selectorId",
          "selectorGenerationId",
          "artifactSha256",
          "identitySetSha256",
          "candidateCount",
          "candidateManifestSha256",
        ]),
      ),
    ]),
  ) as any;
}

function selectorValue(
  row: Record<string, unknown>,
): ProviderRotationSelectorResult {
  return {
    selectorId: text(row.selectorId, 500),
    selectorGenerationId: uuid(row.selectorGenerationId),
    artifactSha256: sha(row.artifactSha256),
    identitySetSha256: sha(row.identitySetSha256),
    candidateCount: nonnegative(row.candidateCount),
    candidateManifestSha256: sha(row.candidateManifestSha256),
  };
}

function sameSelector(
  left: ProviderRotationSelectorResult,
  right: ProviderRotationSelectorResult,
): boolean {
  return (
    left.selectorId === right.selectorId &&
    left.selectorGenerationId === right.selectorGenerationId &&
    left.artifactSha256 === right.artifactSha256 &&
    left.identitySetSha256 === right.identitySetSha256 &&
    left.candidateCount === right.candidateCount &&
    left.candidateManifestSha256 === right.candidateManifestSha256
  );
}

function categoryCounts(
  value: unknown,
): Readonly<Record<"E" | "W" | "X" | "U", number>> {
  const row = exact(value, ["E", "W", "X", "U"]);
  return {
    E: nonnegative(row.E),
    W: nonnegative(row.W),
    X: nonnegative(row.X),
    U: nonnegative(row.U),
  };
}

function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join("\0") !== [...keys].sort().join("\0"))
    invalid();
  return row;
}
function rotationStatus(
  value: unknown,
): value is ProviderRotationResult["status"] {
  return [
    "acquiring_population",
    "population_ready",
    "population_changed",
    "acquiring_broadcasts",
    "acquiring_evidence",
    "complete",
    "blocked_unknown",
  ].includes(String(value));
}
function category(value: unknown): value is "E" | "W" | "X" | "U" {
  return value === "E" || value === "W" || value === "X" || value === "U";
}
function rotationReason(value: unknown): ProviderRotationReason {
  if (
    value !== "retirement_evidence_complete" &&
    value !== "canonical_import_not_completed" &&
    value !== "no_message_history" &&
    value !== "no_recent_message_history" &&
    value !== "provider_unsubscribe" &&
    value !== "provider_bounce" &&
    value !== "provider_complaint" &&
    value !== "provider_suppression" &&
    value !== "fonte_recipient_not_eligible" &&
    value !== "provider_eligibility_unknown" &&
    value !== "identity_unknown" &&
    value !== "evidence_missing" &&
    value !== "evidence_contradictory" &&
    value !== "relationship_evidence_not_preserved"
  )
    invalid();
  return value;
}
function environment(value: unknown): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") invalid();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}
function nullableUuid(value: unknown): string | null {
  return value === null ? null : uuid(value);
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) invalid();
  return value;
}
function positive(value: unknown): number {
  const result = nonnegative(value);
  if (result < 1) invalid();
  return result;
}
function nonnegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    invalid();
  return value;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  )
    invalid();
  return value;
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
function invalid(): never {
  throw new TypeError("core_operator_receipt_invalid");
}
