import type {
  BroadcastSendAllowedAction,
  BroadcastSendDelivery,
  BroadcastSendOperation,
  BroadcastSendOperationPhase,
  BroadcastSendOperationResult,
  BroadcastSendTiming,
  BroadcastSpendLimitRequiredAction,
} from "./operator-broadcast-send-instruction-types.js";
import {
  array,
  boolean,
  exact,
  instant,
  invalid,
  nullableCount,
  nullableInstant,
  nullableText,
  positiveInteger,
  record,
  text,
  uuid,
} from "./operator-broadcast-send-instruction-json-values.js";

const phases = new Set<BroadcastSendOperationPhase>([
  "scheduled",
  "queued",
  "preparing",
  "authorizing",
  "packaging",
  "activation_pending",
  "sending",
  "waiting",
  "action_required",
  "stopping",
  "paused",
  "under_review",
  "canceling",
  "canceled",
  "complete",
  "failed",
]);
const actions = new Set<BroadcastSendAllowedAction>([
  "cancel",
  "replace_schedule",
  "amend_approval",
  "pause",
  "resume",
  "increase_spend_limit",
  "open_required_action",
]);

export function broadcastSendOperationEnvelope(
  value: unknown,
): BroadcastSendOperationResult {
  const root = record(value);
  if (root.status === "absent") {
    exact(root, ["status"]);
    return {
      kind: "broadcast_send_operation",
      status: "absent",
      operation: null,
    };
  }
  exact(
    root,
    root.replayed === undefined
      ? ["status", "operation"]
      : ["status", "operation", "replayed"],
  );
  if (root.status !== "accepted") invalid();
  const operation = broadcastSendOperation(root.operation);
  if (
    root.replayed !== undefined &&
    boolean(root.replayed) !== operation.replayed
  )
    invalid();
  return { kind: "broadcast_send_operation", status: "accepted", operation };
}

export function broadcastSendOperation(value: unknown): BroadcastSendOperation {
  const body = record(value);
  exact(body, [
    "schema",
    "operationId",
    "scope",
    "instructionGeneration",
    "approvalGeneration",
    "acceptedAt",
    "timing",
    "notBefore",
    "phase",
    "reason",
    "retryable",
    "nextAttemptAt",
    "total",
    "timestamps",
    "delivery",
    "requiredAction",
    "allowedActions",
    "executionAuthorized",
    "replayed",
  ]);
  if (
    body.schema !== "broadcast_send_operation.v2" ||
    body.executionAuthorized !== false
  )
    invalid();
  const scope = record(body.scope);
  exact(scope, ["workspaceId", "environment", "draftId"]);
  if (scope.environment !== "production") invalid();
  const rawPhase = body.phase;
  if (
    typeof rawPhase !== "string" ||
    !phases.has(rawPhase as BroadcastSendOperationPhase)
  )
    invalid();
  const timestamps = record(body.timestamps);
  exact(timestamps, [
    "preparationStartedAt",
    "snapshotAt",
    "authorizationCommittedAt",
    "firstSubmissionAt",
    "terminalAt",
  ]);
  const rawActions = array(body.allowedActions, 16);
  if (
    new Set(rawActions).size !== rawActions.length ||
    rawActions.some(
      (action) =>
        typeof action !== "string" ||
        !actions.has(action as BroadcastSendAllowedAction),
    )
  )
    invalid();
  const timing = parseTiming(body.timing);
  const notBefore = instant(body.notBefore);
  if (timing.mode === "scheduled" && timing.not_before !== notBefore) invalid();
  return {
    schema: "broadcast_send_operation.v2",
    operation_id: uuid(body.operationId),
    workspace_id: text(scope.workspaceId, 300),
    environment: "production",
    draft_id: uuid(scope.draftId),
    instruction_generation: positiveInteger(body.instructionGeneration),
    approval_generation: positiveInteger(body.approvalGeneration),
    accepted_at: instant(body.acceptedAt),
    timing,
    not_before: notBefore,
    phase: rawPhase as BroadcastSendOperationPhase,
    reason: nullableText(body.reason, 300),
    retryable: boolean(body.retryable),
    next_attempt_at: nullableInstant(body.nextAttemptAt),
    total: nullableCount(body.total),
    timestamps: {
      preparation_started_at: nullableInstant(timestamps.preparationStartedAt),
      snapshot_at: nullableInstant(timestamps.snapshotAt),
      authorization_committed_at: nullableInstant(
        timestamps.authorizationCommittedAt,
      ),
      first_submission_at: nullableInstant(timestamps.firstSubmissionAt),
      terminal_at: nullableInstant(timestamps.terminalAt),
    },
    delivery: parseDelivery(body.delivery),
    required_action: parseRequiredAction(body.requiredAction),
    allowed_actions: rawActions as readonly BroadcastSendAllowedAction[],
    execution_authorized: false,
    replayed: boolean(body.replayed),
  };
}

function parseTiming(value: unknown): BroadcastSendTiming {
  const timing = record(value);
  if (timing.mode === "now") {
    exact(timing, ["mode"]);
    return { mode: "now" };
  }
  exact(timing, ["mode", "notBefore"]);
  if (timing.mode !== "scheduled") invalid();
  return { mode: "scheduled", not_before: instant(timing.notBefore) };
}

function parseDelivery(value: unknown): BroadcastSendDelivery {
  const delivery = record(value);
  if (delivery.status === "unavailable") {
    exact(delivery, ["status", "reason", "observedAt"]);
    return {
      status: "unavailable",
      reason: text(delivery.reason, 300),
      observed_at: nullableInstant(delivery.observedAt),
    };
  }
  exact(delivery, ["status", "coverage", "observedAt", "counts"]);
  if (
    delivery.status !== "available" ||
    (delivery.coverage !== "complete" && delivery.coverage !== "partial")
  )
    invalid();
  const counts = record(delivery.counts);
  exact(counts, ["providerAccepted", "definitivelyNotAccepted", "unresolved"]);
  return {
    status: "available",
    coverage: delivery.coverage,
    observed_at: instant(delivery.observedAt),
    counts: {
      provider_accepted: nullableCount(counts.providerAccepted),
      definitively_not_accepted: nullableCount(counts.definitivelyNotAccepted),
      unresolved: nullableCount(counts.unresolved),
    },
  };
}

function parseRequiredAction(
  value: unknown,
): BroadcastSpendLimitRequiredAction | null {
  if (value === null) return null;
  const action = record(value);
  exact(action, [
    "kind",
    "billingAccountId",
    "currency",
    "currentMaximumMinor",
    "minimumMaximumMinor",
  ]);
  if (
    action.kind !== "increase_account_spend_limit" ||
    action.currency !== "USD"
  )
    invalid();
  const current = nullableCount(action.currentMaximumMinor);
  const minimum = positiveInteger(action.minimumMaximumMinor);
  if (current !== null && minimum <= current) invalid();
  return {
    kind: "increase_account_spend_limit",
    billing_account_id: text(action.billingAccountId, 300),
    currency: "USD",
    current_maximum_minor: current,
    minimum_maximum_minor: minimum,
  };
}
