import { HostedTestBlockedError } from "./hosted-errors.js";
import { loadHostedConfig, type HostedConfig } from "./hosted-config.js";
import {
  createCoreOperatorClient,
  CoreOperatorError,
  type CoreOperatorClient,
} from "./operator-client.js";
import { withAmbiguousBroadcastRecovery } from "./operator-broadcast-recovery.js";
import type { ProductionBroadcastProgressResult } from "./operator-production-types.js";
import type { OperatorDependencies } from "./operator-run.js";
import type {
  BroadcastCanaryResult,
  OperatorCommand,
  OperatorReceipt,
} from "./operator-types.js";

type BroadcastCanaryCommand = Extract<
  OperatorCommand,
  {
    readonly kind: "broadcast_canary";
  }
>;

interface CanaryState {
  readonly operationId: string;
  readonly deadlineAt: number;
  authorizationStartedAt: Date | null;
  authorizationGranted: boolean;
  mutationObserved: boolean;
  freshSafetyReadbackRequired: boolean;
  pauseRequired: boolean;
  pauseAttempted: boolean;
  baseline: ProductionBroadcastProgressResult | null;
  current: ProductionBroadcastProgressResult | null;
  readonly completedSteps: Set<
    BroadcastCanaryResult["completed_steps"][number]
  >;
}

const OPERATION_LIFETIME_MILLISECONDS = 10 * 60 * 1_000;
const PROGRESS_FRESHNESS_MILLISECONDS = 30_000;
const FUTURE_CLOCK_SKEW_MILLISECONDS = 5_000;
const WAIT_MILLISECONDS = 2_000;
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
    freshSafetyReadbackRequired: false,
    pauseRequired: false,
    pauseAttempted: false,
    baseline: null,
    current: null,
    completedSteps: new Set(),
  };
  let config: HostedConfig | null = null;
  let client: CoreOperatorClient | null = null;

  const authorize = async (
    signal: AbortSignal | undefined,
    renewal: "initial" | "current" | "force" = "initial",
  ): Promise<void> => {
    if (!config) throw new HostedTestBlockedError("authorization_failed");
    state.authorizationStartedAt ??= now();
    const bearer =
      renewal === "initial"
        ? await dependencies.authorize(config, signal)
        : await refreshBearer(
            dependencies,
            config,
            signal,
            renewal === "force",
          );
    if (!bearer.trim()) {
      throw new HostedTestBlockedError("authorization_token_missing");
    }
    state.authorizationGranted = true;
    requireActive(state, signal, now);
    client = createCoreOperatorClient({
      coreApiBaseUrl: config.coreApiBaseUrl,
      bearer,
      fetch: dependencies.fetch as typeof fetch,
      signal,
    });
  };

  const readProgress = async (): Promise<ProductionBroadcastProgressResult> => {
    requireActive(state, dependencies.signal, now);
    await authorize(dependencies.signal, "current");
    try {
      return await client!.readProductionProgress(command);
    } catch (error) {
      if (!unambiguousHumanAuthInvalidRead(error)) throw error;
      requireActive(state, dependencies.signal, now);
      await authorize(dependencies.signal, "force");
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
      try {
        baseline = await client!.controlProductionBroadcast({
          workspace: command.workspace,
          broadcastId: command.broadcastId,
          operation: "resume",
          expectedControlVersion: first.control_version,
        });
      } catch (error) {
        state.freshSafetyReadbackRequired = indeterminateMutation(error);
        throw error;
      }
      state.mutationObserved = true;
      state.current = baseline;
      state.completedSteps.add("safe_resume");
      requireSettlingBaseline(baseline, first, command.releaseCeiling, now());
    }

    requireActive(state, dependencies.signal, now);

    const releaseBaseline = first;
    let progress = baseline;
    let idempotencyKey = command.idempotencyKey;
    while (!targetAccepted(progress, command.releaseCeiling)) {
      requireActive(state, dependencies.signal, now);
      const headroom = acceptanceHeadroom(progress, command.releaseCeiling);
      if (headroom === 0) {
        await waitForProgress(state, dependencies, now);
        const observed = await readProgress();
        requireTargetProgress(
          observed,
          progress,
          command.releaseCeiling,
          now(),
          0,
        );
        progress = observed;
        state.current = observed;
        state.completedSteps.add("authoritative_wait_read");
        continue;
      }

      const maximumRecipientCount = Math.min(
        headroom,
        progress.held_recipient_count,
      );
      if (maximumRecipientCount === 0) {
        throw new HostedTestBlockedError(
          "broadcast_canary_release_no_progress",
        );
      }
      const beforeRelease = progress;
      const releaseInput = {
        workspace: command.workspace,
        broadcastId: command.broadcastId,
        idempotencyKey,
        maximumRecipientCount,
      };
      state.mutationObserved = true;
      try {
        progress = await client!.releaseProductionBroadcast(releaseInput);
      } catch (error) {
        if (!indeterminateMutation(error)) throw error;
        progress = await client!.releaseProductionBroadcast(releaseInput);
      }
      state.current = progress;
      state.completedSteps.add("guarded_release");
      requireTargetProgress(
        progress,
        beforeRelease,
        command.releaseCeiling,
        now(),
        maximumRecipientCount,
      );
      if (!targetAccepted(progress, command.releaseCeiling)) {
        idempotencyKey = randomUUID();
      }
    }

    requireActive(state, dependencies.signal, now);
    await pause(client!, command, state);
    requirePausedTarget(
      state.current!,
      releaseBaseline,
      command.releaseCeiling,
      now(),
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
    const freshSafetyReadback =
      state.freshSafetyReadbackRequired ||
      (state.mutationObserved && requiresFreshSafetyAuthorization(error));
    if (
      config &&
      state.pauseRequired &&
      !unambiguousControlConflict(error) &&
      (freshSafetyReadback || (client && !state.pauseAttempted))
    ) {
      try {
        if (freshSafetyReadback) {
          await freshSafetyPause(config, command, state, dependencies, now);
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
  const bearer = await refreshBearer(dependencies, config, signal, true);
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
  force = false,
): Promise<string> {
  if (!dependencies.renewAuthorization) {
    throw new HostedTestBlockedError("authorization_refresh_unavailable");
  }
  return dependencies.renewAuthorization(config, signal, force);
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
    progress.held_recipient_count !==
      baseline.held_recipient_count - releasedDelta ||
    progress.accepted_recipient_count < baseline.accepted_recipient_count ||
    possibleAcceptances(progress) > releaseCeiling ||
    releasedAccounting(progress) !== progress.released_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_pause_unconfirmed");
  }
}

function unambiguousHumanAuthInvalidRead(error: unknown): boolean {
  return (
    error instanceof CoreOperatorError &&
    error.reason === "human_auth_invalid" &&
    error.statusCode === 401 &&
    error.coreEffect === "none"
  );
}

function unambiguousControlConflict(error: unknown): boolean {
  return (
    error instanceof CoreOperatorError &&
    error.reason === "broadcast_send_control_conflict" &&
    error.statusCode === 409 &&
    error.coreEffect === "none"
  );
}

function requiresFreshSafetyAuthorization(error: unknown): boolean {
  const reason = failureReason(error);
  return (
    reason === "human_auth_invalid" ||
    reason === "operation_cancelled" ||
    reason === "operation_expired" ||
    reason === "browser_open_failed" ||
    reason.startsWith("authorization_")
  );
}

function requireOpenBaseline(
  progress: ProductionBroadcastProgressResult,
  releaseCeiling: number,
): void {
  const headroom = acceptanceHeadroom(progress, releaseCeiling);
  const open =
    (progress.status === "paused" && progress.control_state === "paused") ||
    (progress.status === "processing" && progress.control_state === "active");
  if (
    !open ||
    progress.held_recipient_count < headroom ||
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
    progress.accepted_recipient_count < frozen.accepted_recipient_count ||
    possibleAcceptances(progress) > releaseCeiling ||
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
  maximumRecipientCount: number,
): number {
  requireFresh(progress, observedAt);
  const releasedDelta =
    progress.released_recipient_count - baseline.released_recipient_count;
  const acceptedDelta =
    progress.accepted_recipient_count - baseline.accepted_recipient_count;
  const cancelledDelta =
    progress.cancelled_recipient_count - baseline.cancelled_recipient_count;
  if (maximumRecipientCount > 0 && releasedDelta < 1) {
    throw new HostedTestBlockedError("broadcast_canary_release_no_progress");
  }
  if (maximumRecipientCount > 0 && releasedDelta > maximumRecipientCount) {
    throw new HostedTestBlockedError(
      "broadcast_canary_release_ceiling_not_exact",
    );
  }
  requireFrozenSafetyCounts(progress, baseline);
  if (
    progress.control_state !== "active" ||
    progress.status !== "processing" ||
    (maximumRecipientCount === 0 && releasedDelta !== 0) ||
    progress.held_recipient_count !==
      baseline.held_recipient_count - releasedDelta ||
    acceptedDelta < 0 ||
    cancelledDelta < 0 ||
    possibleAcceptances(progress) > releaseCeiling ||
    releasedAccounting(progress) !== progress.released_recipient_count
  ) {
    throw new HostedTestBlockedError("broadcast_canary_authority_changed");
  }
  return releasedDelta;
}

function requirePausedTarget(
  progress: ProductionBroadcastProgressResult,
  baseline: ProductionBroadcastProgressResult,
  releaseCeiling: number,
  observedAt: Date,
): void {
  requireFresh(progress, observedAt);
  requireFrozenSafetyCounts(progress, baseline);
  const releasedDelta =
    progress.released_recipient_count - baseline.released_recipient_count;
  if (
    progress.status !== "paused" ||
    progress.control_state !== "paused" ||
    progress.held_recipient_count !==
      baseline.held_recipient_count - releasedDelta ||
    releasedAccounting(progress) !== progress.released_recipient_count ||
    !targetAccepted(progress, releaseCeiling)
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

function targetAccepted(
  progress: ProductionBroadcastProgressResult,
  releaseCeiling: number,
): boolean {
  return (
    progress.accepted_recipient_count === releaseCeiling &&
    progress.pending_recipient_count === 0 &&
    progress.claimed_recipient_count === 0
  );
}

function acceptanceHeadroom(
  progress: ProductionBroadcastProgressResult,
  releaseCeiling: number,
): number {
  const possible = possibleAcceptances(progress);
  if (possible > releaseCeiling) {
    throw new HostedTestBlockedError(
      "broadcast_canary_release_ceiling_not_exact",
    );
  }
  return releaseCeiling - possible;
}

function possibleAcceptances(
  progress: ProductionBroadcastProgressResult,
): number {
  return (
    progress.accepted_recipient_count +
    progress.pending_recipient_count +
    progress.claimed_recipient_count
  );
}

function indeterminateMutation(error: unknown): boolean {
  return error instanceof CoreOperatorError && error.coreEffect === "unknown";
}

function releasedAccounting(
  progress: ProductionBroadcastProgressResult,
): number {
  return (
    progress.pending_recipient_count +
    progress.claimed_recipient_count +
    progress.accepted_recipient_count +
    progress.refused_recipient_count +
    progress.unknown_recipient_count +
    progress.cancelled_recipient_count
  );
}

async function pause(
  client: CoreOperatorClient,
  command: BroadcastCanaryCommand,
  state: CanaryState,
): Promise<void> {
  const observed = state.current;
  if (!observed) {
    throw new HostedTestBlockedError("broadcast_canary_pause_unconfirmed");
  }
  state.pauseAttempted = true;
  state.current = await client.controlProductionBroadcast({
    workspace: command.workspace,
    broadcastId: command.broadcastId,
    operation: "pause",
    expectedControlVersion: observed.control_version,
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
  return error instanceof CoreOperatorError ||
    error instanceof HostedTestBlockedError
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
  return withAmbiguousBroadcastRecovery<OperatorReceipt>(command, {
    schema_version: "fonte.cli.operator_receipt.v1",
    command: command.kind,
    outcome,
    reason,
    workspace: command.workspace,
    authority: {
      status: "current",
      contract_id: "fonte.core.production_broadcast.v1",
    },
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
  });
}
