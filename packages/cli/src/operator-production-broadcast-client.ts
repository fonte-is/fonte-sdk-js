import type { CoreRequester } from "./operator-core-request.js";
import { CoreOperatorError } from "./operator-core-request.js";
import {
  audienceAppendPreflight,
  audienceAppendResult,
} from "./operator-audience-append-json.js";
import {
  productionProgress,
  productionResult,
  productionTest,
  queuedBroadcast,
} from "./operator-production-json.js";
import type {
  ProductionAuthorizeInput,
  ProductionAudienceAppendInput,
  ProductionAudienceAppendPreflightResult,
  ProductionAudienceAppendResult,
  ProductionBroadcastControlInput,
  ProductionBroadcastProgressResult,
  ProductionBroadcastReadInput,
  ProductionBroadcastReleaseInput,
  ProductionBroadcastResult,
  ProductionDraftReadInput,
  ProductionTestReadInput,
  ProductionTestResult,
  ProductionTestSendInput,
  QueuedBroadcastResult,
} from "./operator-production-types.js";

export interface ProductionBroadcastClient {
  sendProductionTest(
    input: ProductionTestSendInput,
  ): Promise<QueuedBroadcastResult>;
  readProductionTest(
    input: ProductionTestReadInput,
  ): Promise<ProductionTestResult>;
  authorizeProductionBroadcast(
    input: ProductionAuthorizeInput,
  ): Promise<QueuedBroadcastResult>;
  readProductionProgress(
    input: ProductionBroadcastReadInput,
  ): Promise<ProductionBroadcastProgressResult>;
  controlProductionBroadcast(
    input: ProductionBroadcastControlInput,
  ): Promise<ProductionBroadcastProgressResult>;
  releaseProductionBroadcast(
    input: ProductionBroadcastReleaseInput,
  ): Promise<ProductionBroadcastProgressResult>;
  readProductionResult(
    input: ProductionBroadcastReadInput,
  ): Promise<ProductionBroadcastResult>;
  preflightProductionAudienceAppend(
    input: ProductionBroadcastReadInput,
  ): Promise<ProductionAudienceAppendPreflightResult>;
  appendProductionAudience(
    input: ProductionAudienceAppendInput,
    preflight: ProductionAudienceAppendPreflightResult,
  ): Promise<ProductionAudienceAppendResult>;
}

export function createProductionBroadcastClient(
  request: CoreRequester,
): ProductionBroadcastClient {
  return {
    async sendProductionTest(input) {
      const result = parse(
        (value) => queuedBroadcast(value, "broadcast_test_queued"),
        await request(approvalPath(input), {
          idempotencyKey: input.idempotencyKey,
          lostResponseEffect: "unknown",
          body: {
            operation: "send_test_to_verified_account",
            expectedVersion: input.revision,
            postalAddress: input.postalAddress,
            idempotencyKey: input.idempotencyKey,
            clickTrackingEnabled: false,
          },
        }),
        "unknown",
      );
      return matchingDraft(result, input.draftId, "unknown");
    },
    async readProductionTest(input) {
      const result = parse(
        productionTest,
        await request(
          `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}/test-deliveries/${segment(input.testId)}?environment=production`,
        ),
      );
      if (result.draft_id !== input.draftId || result.test_id !== input.testId)
        invalid("none");
      return result;
    },
    async authorizeProductionBroadcast(input) {
      const result = parse(
        (value) => queuedBroadcast(value, "broadcast_authorization"),
        await request(approvalPath(input), {
          idempotencyKey: input.idempotencyKey,
          lostResponseEffect: "unknown",
          body: {
            operation: "authorize_persisted_production",
            expectedVersion: input.revision,
            postalAddress: input.postalAddress,
            idempotencyKey: input.idempotencyKey,
            ...(input.audienceReuseOverride
              ? { audienceReuseOverride: input.audienceReuseOverride }
              : {}),
          },
        }),
        "unknown",
      );
      return matchingDraft(result, input.draftId, "unknown");
    },
    async readProductionProgress(input) {
      return matchingBroadcast(
        parse(
          productionProgress,
          await request(
            `${broadcastPath(input)}/progress?environment=production`,
          ),
        ),
        input.broadcastId,
        "none",
      );
    },
    async controlProductionBroadcast(input) {
      return matchingBroadcast(
        parse(
          productionProgress,
          await request(
            `${broadcastPath(input)}/control?environment=production`,
            {
              lostResponseEffect: "unknown",
              body: { operation: input.operation },
            },
          ),
          "unknown",
        ),
        input.broadcastId,
        "unknown",
      );
    },
    async releaseProductionBroadcast(input) {
      return matchingBroadcast(
        parse(
          productionProgress,
          await request(
            `${broadcastPath(input)}/control?environment=production`,
            {
              idempotencyKey: input.idempotencyKey,
              lostResponseEffect: "unknown",
              body: {
                operation: "release",
                idempotencyKey: input.idempotencyKey,
                maximumRecipientCount: input.maximumRecipientCount,
              },
            },
          ),
          "unknown",
        ),
        input.broadcastId,
        "unknown",
      );
    },
    async readProductionResult(input) {
      return matchingBroadcast(
        parse(
          productionResult,
          await request(
            `${broadcastPath(input)}/results?environment=production`,
          ),
        ),
        input.broadcastId,
        "none",
      );
    },
    async preflightProductionAudienceAppend(input) {
      try {
        const result = parse(
          audienceAppendPreflight,
          await request(
            `${broadcastPath(input)}/audience-append?environment=production`,
          ),
        );
        if (result.readback.broadcast_id !== input.broadcastId) invalid("none");
        return result;
      } catch (error) {
        return audienceAppendFailure(error);
      }
    },
    async appendProductionAudience(input, preflight) {
      try {
        return parse(
          (value) => audienceAppendResult(value, input, preflight),
          await request(
            `${broadcastPath(input)}/audience-append?environment=production`,
            {
              idempotencyKey: input.idempotencyKey,
              lostResponseEffect: "unknown",
              timeoutMs: 60_000,
              body: {
                expectedBaseline: baselineBody(preflight.baseline),
                frozenAudienceId: input.frozenAudienceId,
                canonicalIdentitySetSha256: input.identitySetSha256,
                acceptedTargetCeiling: input.acceptedTargetCeiling,
                appendAuthorizationId: input.appendAuthorizationId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          ),
          "unknown",
        );
      } catch (error) {
        return audienceAppendFailure(error);
      }
    },
  };
}

function baselineBody(
  baseline: ProductionAudienceAppendPreflightResult["baseline"],
): Record<string, unknown> {
  return {
    authorizationId: baseline.authorization_id,
    recipientSnapshotId: baseline.recipient_snapshot_id,
    sendPlanDecisionId: baseline.send_plan_decision_id,
    draftVersion: baseline.draft_version,
    senderId: baseline.sender_id,
    renderContentDigest: baseline.render_content_digest,
    communicationPurposeId: baseline.communication_purpose_id,
    originalRecipientCount: baseline.original_recipient_count,
    currentSnapshotCount: baseline.current_snapshot_count,
    currentReleasedRecipientCount: baseline.current_released_recipient_count,
    currentAcceptedRecipientCount: baseline.current_accepted_recipient_count,
    currentBillingReservedRecipientCount:
      baseline.current_billing_reserved_recipient_count,
    controlState: baseline.control_state,
  };
}

function audienceAppendFailure(error: unknown): never {
  if (!(error instanceof CoreOperatorError)) throw error;
  if (
    error.reason === "core_api_unavailable" ||
    error.reason === "core_operator_receipt_invalid" ||
    error.reason === "operation_cancelled"
  ) {
    throw error;
  }
  const reason =
    error.statusCode === 401
      ? "human_auth_invalid"
      : error.statusCode === 404
        ? "broadcast_audience_append_not_found"
        : error.statusCode === 409 || error.statusCode === 412
          ? "broadcast_audience_append_conflict"
          : error.statusCode === 422
            ? "broadcast_audience_append_has_no_new_recipients"
            : error.statusCode === 503
              ? "broadcast_audience_append_unavailable"
              : error.reason;
  throw new CoreOperatorError(reason, error.statusCode, error.coreEffect);
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
}

function approvalPath(input: ProductionDraftReadInput): string {
  return `${workspacePath(input.workspace)}/marketing-broadcasts/${segment(input.draftId)}/send-approvals?environment=production`;
}

function broadcastPath(input: ProductionBroadcastReadInput): string {
  return `${workspacePath(input.workspace)}/marketing-broadcasts/${segment(input.broadcastId)}`;
}

function matchingDraft<T extends { readonly draft_id: string }>(
  result: T,
  draftId: string,
  effect: "none" | "unknown",
): T {
  if (result.draft_id !== draftId) invalid(effect);
  return result;
}

function matchingBroadcast<T extends { readonly broadcast_id: string }>(
  result: T,
  broadcastId: string,
  effect: "none" | "unknown",
): T {
  if (result.broadcast_id !== broadcastId) invalid(effect);
  return result;
}

function parse<T>(
  parser: (value: unknown) => T,
  value: unknown,
  effect: "none" | "unknown" = "none",
): T {
  try {
    return parser(value);
  } catch {
    return invalid(effect);
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalid(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
