export const workspace = "northstar";
export const draftId = "00000000-0000-4000-8000-000000000701";
export const operationId = "00000000-0000-4000-8000-000000000702";
export const requestId = "00000000-0000-4000-8000-000000000703";
export const path = `/v1/workspaces/${workspace}/broadcast-drafts/${draftId}/send-intent`;

export function envelope(value) {
  return { status: "accepted", operation: value, replayed: value.replayed };
}

export function operation(overrides = {}) {
  const phase = overrides.phase ?? "queued";
  return {
    schema: "broadcast_send_operation.v2",
    operationId,
    scope: {
      workspaceId: "workspace-internal",
      environment: "production",
      draftId,
    },
    instructionGeneration: overrides.instructionGeneration ?? 1,
    approvalGeneration: overrides.approvalGeneration ?? 1,
    acceptedAt: "2026-09-22T15:00:00.000Z",
    timing: { mode: "now" },
    notBefore: "2026-09-22T15:00:00.000Z",
    phase,
    reason:
      phase === "action_required" ? "account_spend_limit_insufficient" : null,
    retryable: !["action_required", "canceled", "complete", "failed"].includes(
      phase,
    ),
    nextAttemptAt: ["queued", "preparing"].includes(phase)
      ? "2026-09-22T15:00:01.000Z"
      : null,
    total: null,
    timestamps: {
      preparationStartedAt:
        phase === "preparing" ? "2026-09-22T15:00:01.000Z" : null,
      snapshotAt: null,
      authorizationCommittedAt: null,
      firstSubmissionAt: null,
      terminalAt: ["canceled", "complete", "failed"].includes(phase)
        ? "2026-09-22T15:00:02.000Z"
        : null,
    },
    delivery: {
      status: "unavailable",
      reason: "provider_submission_not_started",
      observedAt: null,
    },
    requiredAction: overrides.requiredAction ?? null,
    allowedActions:
      overrides.allowedActions ?? (phase === "canceled" ? [] : ["cancel"]),
    executionAuthorized: false,
    replayed: overrides.replayed ?? false,
  };
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
