import { HostedTestBlockedError } from "./hosted-errors.js";
import { loadHostedConfig, type HostedConfig } from "./hosted-config.js";
import {
  createCoreOperatorClient,
  CoreOperatorError,
  type CoreOperatorClient,
} from "./operator-client.js";
import type { ProductionBroadcastProgressResult } from "./operator-production-types.js";
import type { OperatorDependencies } from "./operator-run.js";
import type {
  BroadcastCanaryResult,
  OperatorCommand,
  OperatorReceipt,
} from "./operator-types.js";

type BroadcastCanaryCommand = Extract<OperatorCommand, {
  readonly kind: "broadcast_canary";
}>;

interface CanaryState {
  readonly operationId: string;
  readonly deadlineAt: number;
  authorizationStartedAt: Date | null;
  authorizationGranted: boolean;
  mutationObserved: boolean;
  pauseRequired: boolean;
  pauseAttempted: boolean;
  baseline: ProductionBroadcastProgressResult | null;
  current: ProductionBroadcastProgressResult | null;
  readonly completedSteps: Set<BroadcastCanaryResult["completed_steps"][number]>;
}

const OPERATION_LIFETIME_MILLISECONDS = 10 * 60 * 1_000;
const PROGRESS_FRESHNESS_MILLISECONDS = 30_000;
const FUTURE_CLOCK_SKEW_MILLISECONDS = 5_000;
const WAIT_MILLISECONDS = 2_000;
const AUTHORIZATION_RENEWAL_LEAD_MILLISECONDS = 30_000;
const SAFETY_PAUSE_TIMEOUT_MILLISECONDS = 60_000;

export async function runBroadcastCanary(
  command: BroadcastCanaryCommand,
  dependencies: OperatorDependencies,
  operationId: string,
  randomUUID: () => string,
): Promise<OperatorReceipt> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  const state: CanaryState = {
    operationId,
    deadlineAt: startedAt.getTime() + OPERATION_LIFETIME_MILLISECONDS,
    authorizationStartedAt: null,
    authorizationGranted: false,
    mutationObserved: false,
    pauseRequired: false,
    pauseAttempted: false,
    baseline: null,
    current: null,
    completedSteps: new Set(),
  };
  let config: HostedConfig | null = null;
  let client: CoreOperatorClient | null = null;
  let bearerExpiresAt: number | null = null;

  const authorize = async (
    signal: AbortSignal | undefined,
    renewal = false,
  ): Promise<void> => {
    if (!config) throw new HostedTestBlockedError("authorization_failed");
    state.authorizationStartedAt ??= now();
    const bearer = renewal
      ? await refreshBearer(dependencies, config, signal)
      : await dependencies.authorize(config, signal);
    if (!bearer.trim()) {
      throw new HostedTestBlockedError("authorization_token_missing");
    }
    state.authorizationGranted = true;
    requireActive(state, signal, now);
    bearerExpiresAt = bearerExpiration(bearer);
    client = createCoreOperatorClient({
      coreApiBaseUrl: config.coreApiBaseUrl,
      bearer,
      fetch: dependencies.fetch as typeof fetch,
      signal,
    });
  };

  const readProgress = async (): Promise<ProductionBroadcastProgressResult> => {
    requireActive(state, dependencies.signal, now);
    if (
      bearerExpiresAt !== null &&
      now().getTime() + AUTHORIZATION_RENEWAL_LEAD_MILLISECONDS >=
        bearerExpiresAt
    ) {
      await authorize(dependencies.signal, true);
    }
    try {
      return await client!.readProductionProgress(command);
    } catch (error) {
      if (!unambiguousHumanAuthInvalidRead(error)) throw error;
      requireActive(state, dependencies.signal, now);
      await authorize(dependencies.signal, true);
      return client!.readProductionProgress(command);
    }
  };

  try {
    requireActive(state, dependencies.signal, now);
    config = await loadHostedConfig(
      dependencies.fetch as typeof fetch,
      dependencies.configUrl,
    );
    if (config.scopes.length !== 1 || config.scopes[0] !== "email") {
      throw new HostedTestBlockedError("operation_authority_expansion");
    }
    await authorize(dependencies.signal);
    requireActive(state, dependencies.signal, now);

    const first = await readProgress();
    state.baseline = first;
    state.current = first;
    state.completedSteps.add("authoritative_status");
    requireFresh(first, now());
    requireOpenBaseline(first, command.releaseCeiling);
    state.pauseRequired = first.control_state === "active";

    let baseline = first;
    if (baseline.control_state === "paused") {
      state.pauseRequired = true;
      baseline = await client!.controlProductionBroadcast({
        workspace: command.workspace,
        broadcastId: command.broadcastId,
        operation: "resume",
      });
      state.mutationObserved = true;
      state.current = baseline;
      state.completedSteps.add("safe_resume");
      requireSettlingBaseline(baseline, first, command.releaseCeiling, now());
    }

    while (
      baseline.pending_recipient_count > 0 ||
      baseline.claimed_recipient_count > 0
    ) {
      await waitForProgress(state, dependencies, now);
      baseline = await readProgress();
      state.baseline = baseline;
      state.current = baseline;
      state.completedSteps.add("authoritative_wait_read");
      requireSettlingBaseline(baseline, first, command.releaseCeiling, now());
    }
    state.baseline = baseline;
    requireActive(state, dependencies.signal, now);

    const releaseBaseline = baseline;
    let trancheBaseline = baseline;
    let idempotencyKey = command.idempotencyKey;
    while (trancheBaseline.released_recipient_count < command.releaseCeiling) {
      requireActive(state, dependencies.signal, now);
      const maximumRecipientCount =
        command.releaseCeiling - trancheBaseline.released_recipient_count;
      let progress = await client!.releaseProductionBroadcast({
        workspace: command.workspace,
        broadcastId: command.broadcastId,
        idempotencyKey,
        maximumRecipientCount,
      });
      state.mutationObserved = true;
      state.current = progress;
      state.completedSteps.add("guarded_release");
      const releasedDelta = requireTargetProgress(
        progress, trancheBaseline, command.releaseCeiling, now(),
      );

      while (!targetAccepted(progress, trancheBaseline, releasedDelta)) {
        await waitForProgress(state, dependencies, now);
        progress = await readProgress();
        state.current = progress;
        state.completedSteps.add("authoritative_wait_read");
        requireTargetProgress(
          progress, trancheBaseline, command.releaseCeiling, now(), releasedDelta,
        );
      }
      trancheBaseline = progress;
      if (trancheBaseline.released_recipient_count < command.releaseCeiling) {
        idempotencyKey = randomUUID();
      }
    }

    requireActive(state, dependencies.signal, now);
    await pause(client!, command, state);
    requirePausedTarget(
      state.current!, releaseBaseline, command.releaseCeiling,
      command.releaseCeiling - releaseBaseline.released_recipient_count, now(),
    );
    return receipt(
      command,
      state,
      now(),
      "completed",
      state.current!.cancelled_recipient_count >
          releaseBaseline.cancelled_recipient_count
        ? "broadcast_canary_ceiling_settled_with_cancellation_and_paused"
        : "broadcast_canary_ceiling_accepted_and_paused",
      "controlled",
    );
  } catch (error) {
    const core = error instanceof CoreOperatorError ? error : null;
    let coreEffect: OperatorReceipt["core_effect"] = core?.coreEffect ?? "none";
    const freshSafetyAuthorization =
      state.mutationObserved && requiresFreshSafetyAuthorization(error);
    if (
      config &&
      state.pauseRequired &&
      (freshSafetyAuthorization || (client && !state.pauseAttempted))
    ) {
      try {
        if (freshSafetyAuthorization) {
          await freshSafetyPause(
            config,
            command,
            state,
            dependencies,
            now,
          );
        } else {
          await pause(client!, command, state);
        }
        if (coreEffect === "none") coreEffect = "controlled";
      } catch {
        if (state.mutationObserved) coreEffect = "unknown";
      }
    }
    if (state.mutationObserved && coreEffect === "none") coreEffect = "unknown";
    return receipt(
      command,
      state,
      now(),
      "blocked",
      failureReason(error),
      coreEffect,
    );
  }
}

async function freshSafetyPause(
  config: HostedConfig,
  command: BroadcastCanaryCommand,
  state: CanaryState,
  dependencies: OperatorDependencies,
  now: () => Date,
): Promise<void> {
  const signal = AbortSignal.timeout(SAFETY_PAUSE_TIMEOUT_MILLISECONDS);
  const bearer = await refreshBearer(dependencies, config, signal);
  if (!bearer.trim()) {
    throw new HostedTestBlockedError("authorization_token_missing");
  }
  const client = createCoreOperatorClient({
    coreApiBaseUrl: config.coreApiBaseUrl,
    bearer,
    fetch: dependencies.fetch as typeof fetch,
    signal,
  });
  const observed = await client.readProductionProgress(command);
  state.current = observed;
  state.completedSteps.add("authoritative_wait_read");
  if (observed.control_state === "active") {
    await pause(client, command, state);
  }
  requireSafetyPaused(
    state.current,
    state.baseline,
    command.releaseCeiling,
    now(),
  );
}

function refreshBearer(
  dependencies: OperatorDependencies,
  config: HostedConfig,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!dependencies.renewAuthorization) {
    throw new HostedTestBlockedError("authorization_refresh_unavailable");
  }
  return dependencies.renewAuthorization(config, signal);
}

function requireSafetyPaused(
  progress: ProductionBroadcastProgressResult | null,
  baseline: ProductionBroadcastProgressResult | null,
  releaseCeiling: number,
  observedAt: Date,
): void {
  if (!progress || !baseline) {
    throw new HostedTestBlockedError("broadcast_canary_pause_unconfirmed");
  }
  requireFresh(progress, observedAt);
  requireFrozenSafetyCounts(progress, baseline);
  const releasedDelta =
    progress.released_recipient_count - baseline.released_recipient_count;
  if (
    progress.status !== "paused" ||
    progress.control_state !== "paused" ||
    releasedDelta < 0 ||
    progress.released_recipient_count > releaseCeiling ||
    progress.held_recipient_count !==
      baseline.held_recipient_count - releasedDelta ||
    progress.accepted_recipient_count < baseline.accepted_recipient_count ||
    releasedAccounting(progress) !== progress.released_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_pause_unconfirmed");
  }
}

function unambiguousHumanAuthInvalidRead(error: unknown): boolean {
  return error instanceof CoreOperatorError &&
    error.reason === "human_auth_invalid" &&
    error.statusCode === 401 &&
    error.coreEffect === "none";
}

function requiresFreshSafetyAuthorization(error: unknown): boolean {
  const reason = failureReason(error);
  return reason === "human_auth_invalid" ||
    reason === "operation_cancelled" ||
    reason === "operation_expired" ||
    reason === "browser_open_failed" ||
    reason.startsWith("authorization_");
}

function bearerExpiration(bearer: string): number | null {
  const encoded = bearer.split(".")[1];
  if (!encoded) return null;
  try {
    const body = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as { readonly exp?: unknown };
    return Number.isSafeInteger(body.exp) && Number(body.exp) > 0
      ? Number(body.exp) * 1_000
      : null;
  } catch {
    return null;
  }
}

function requireOpenBaseline(
  progress: ProductionBroadcastProgressResult,
  releaseCeiling: number,
): void {
  const delta = releaseCeiling - progress.released_recipient_count;
  const open =
    (progress.status === "paused" && progress.control_state === "paused") ||
    (progress.status === "processing" && progress.control_state === "active");
  if (
    !open ||
    delta < 1 ||
    progress.held_recipient_count < delta ||
    releasedAccounting(progress) !== progress.released_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_baseline_unsafe");
  }
}

function requireSettlingBaseline(
  progress: ProductionBroadcastProgressResult,
  frozen: ProductionBroadcastProgressResult,
  releaseCeiling: number,
  observedAt: Date,
): void {
  requireFresh(progress, observedAt);
  requireFrozenSafetyCounts(progress, frozen);
  if (
    progress.status !== "processing" ||
    progress.control_state !== "active" ||
    progress.released_recipient_count !== frozen.released_recipient_count ||
    progress.held_recipient_count !== frozen.held_recipient_count ||
    progress.released_recipient_count >= releaseCeiling ||
    progress.accepted_recipient_count < frozen.accepted_recipient_count ||
    releasedAccounting(progress) !== progress.released_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_authority_changed");
  }
}

function requireTargetProgress(
  progress: ProductionBroadcastProgressResult,
  baseline: ProductionBroadcastProgressResult,
  releaseCeiling: number,
  observedAt: Date,
  expectedReleasedDelta?: number,
): number {
  requireFresh(progress, observedAt);
  const releasedDelta =
    progress.released_recipient_count - baseline.released_recipient_count;
  const acceptedDelta =
    progress.accepted_recipient_count - baseline.accepted_recipient_count;
  const cancelledDelta =
    progress.cancelled_recipient_count - baseline.cancelled_recipient_count;
  if (releasedDelta < 1) {
    throw new HostedTestBlockedError("broadcast_canary_release_no_progress");
  }
  if (
    (expectedReleasedDelta !== undefined &&
      releasedDelta !== expectedReleasedDelta) ||
    progress.released_recipient_count > releaseCeiling ||
    progress.held_recipient_count !== baseline.held_recipient_count - releasedDelta
  ) {
    throw new HostedTestBlockedError("broadcast_canary_release_ceiling_not_exact");
  }
  requireFrozenSafetyCounts(progress, baseline);
  if (
    progress.control_state !== "active" ||
    progress.status !== "processing" ||
    acceptedDelta < 0 ||
    cancelledDelta < 0 ||
    acceptedDelta + cancelledDelta > releasedDelta ||
    releasedAccounting(progress) !== progress.released_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_authority_changed");
  }
  return releasedDelta;
}

function targetAccepted(
  progress: ProductionBroadcastProgressResult,
  baseline: ProductionBroadcastProgressResult,
  releasedDelta: number,
): boolean {
  return (
    progress.accepted_recipient_count - baseline.accepted_recipient_count +
        progress.cancelled_recipient_count -
        baseline.cancelled_recipient_count === releasedDelta &&
    progress.pending_recipient_count === 0 &&
    progress.claimed_recipient_count === 0
  );
}

function requirePausedTarget(
  progress: ProductionBroadcastProgressResult,
  baseline: ProductionBroadcastProgressResult,
  releaseCeiling: number,
  releasedDelta: number,
  observedAt: Date,
): void {
  requireFresh(progress, observedAt);
  requireFrozenSafetyCounts(progress, baseline);
  if (
    progress.status !== "paused" ||
    progress.control_state !== "paused" ||
    progress.released_recipient_count !== releaseCeiling ||
    progress.held_recipient_count !==
      baseline.held_recipient_count - releasedDelta ||
    releasedAccounting(progress) !== progress.released_recipient_count ||
    !targetAccepted(progress, baseline, releasedDelta)
  ) {
    throw new HostedTestBlockedError("broadcast_canary_pause_unconfirmed");
  }
}

function requireFrozenSafetyCounts(
  progress: ProductionBroadcastProgressResult,
  baseline: ProductionBroadcastProgressResult,
): void {
  if (progress.refused_recipient_count > baseline.refused_recipient_count) {
    throw new HostedTestBlockedError("broadcast_canary_refused_increase");
  }
  if (progress.unknown_recipient_count > baseline.unknown_recipient_count) {
    throw new HostedTestBlockedError("broadcast_canary_unknown_increase");
  }
  if (
    progress.refused_recipient_count !== baseline.refused_recipient_count ||
    progress.unknown_recipient_count !== baseline.unknown_recipient_count ||
    progress.cancelled_recipient_count < baseline.cancelled_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_authority_changed");
  }
}

function releasedAccounting(
  progress: ProductionBroadcastProgressResult,
): number {
  return progress.pending_recipient_count + progress.claimed_recipient_count
    + progress.accepted_recipient_count + progress.refused_recipient_count
    + progress.unknown_recipient_count + progress.cancelled_recipient_count;
}

async function pause(
  client: CoreOperatorClient,
  command: BroadcastCanaryCommand,
  state: CanaryState,
): Promise<void> {
  state.pauseAttempted = true;
  state.current = await client.controlProductionBroadcast({
    workspace: command.workspace,
    broadcastId: command.broadcastId,
    operation: "pause",
  });
  state.completedSteps.add("safety_pause");
}

async function waitForProgress(
  state: CanaryState,
  dependencies: OperatorDependencies,
  now: () => Date,
): Promise<void> {
  requireActive(state, dependencies.signal, now);
  if (now().getTime() + WAIT_MILLISECONDS >= state.deadlineAt) {
    throw new HostedTestBlockedError("operation_expired");
  }
  const sleeping = dependencies.sleep(WAIT_MILLISECONDS);
  if (!dependencies.signal) {
    await sleeping;
  } else {
    await Promise.race([
      sleeping,
      new Promise<never>((_resolve, reject) => {
        const cancel = () => {
          dependencies.signal?.removeEventListener("abort", cancel);
          reject(new HostedTestBlockedError("operation_cancelled"));
        };
        dependencies.signal?.addEventListener("abort", cancel, { once: true });
        void sleeping.finally(() =>
          dependencies.signal?.removeEventListener("abort", cancel),
        );
      }),
    ]);
  }
  requireActive(state, dependencies.signal, now);
}

function requireActive(
  state: CanaryState,
  signal: AbortSignal | undefined,
  now: () => Date,
): void {
  if (signal?.aborted) throw new HostedTestBlockedError("operation_cancelled");
  if (now().getTime() >= state.deadlineAt)
    throw new HostedTestBlockedError("operation_expired");
}

function requireFresh(
  progress: ProductionBroadcastProgressResult,
  observedAt: Date,
): void {
  const asOf = Date.parse(progress.as_of);
  if (
    asOf > observedAt.getTime() + FUTURE_CLOCK_SKEW_MILLISECONDS ||
    observedAt.getTime() - asOf > PROGRESS_FRESHNESS_MILLISECONDS
  ) {
    throw new HostedTestBlockedError("broadcast_canary_authority_stale");
  }
}

function failureReason(error: unknown): string {
  return error instanceof CoreOperatorError || error instanceof HostedTestBlockedError
    ? error.reason
    : "operator_request_failed";
}

function receipt(
  command: BroadcastCanaryCommand,
  state: CanaryState,
  endedAt: Date,
  outcome: "completed" | "blocked",
  reason: string,
  coreEffect: OperatorReceipt["core_effect"],
): OperatorReceipt {
  return {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome,
    reason,
    workspace: command.workspace,
    authority: { status: "current", contract_id: "fonte.core.production_broadcast.v1" },
    core_effect: coreEffect,
    result: {
      kind: "broadcast_canary",
      operation_id: state.operationId,
      broadcast_id: command.broadcastId,
      environment: "production",
      release_ceiling: command.releaseCeiling,
      authorization: {
        status: state.authorizationGranted ? "released" : "not_granted",
        started_at: state.authorizationStartedAt?.toISOString() ?? null,
        ended_at: endedAt.toISOString(),
        bearer_persisted: false,
      },
      completed_steps: [...state.completedSteps],
      baseline: state.baseline,
      final: state.current,
    },
  };
}
