import type { CoreRequester } from "./operator-core-request.js";
import { CoreOperatorError } from "./operator-core-request.js";
import {
  productionProgress,
  productionResult,
  productionTest,
  queuedBroadcast,
} from "./operator-production-json.js";
import type {
  ProductionAuthorizeInput,
  ProductionBroadcastControlInput,
  ProductionBroadcastProgressResult,
  ProductionBroadcastReadInput,
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
  readProductionResult(
    input: ProductionBroadcastReadInput,
  ): Promise<ProductionBroadcastResult>;
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
  };
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
