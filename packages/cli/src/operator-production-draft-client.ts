import type { CoreRequester } from "./operator-core-request.js";
import { CoreOperatorError } from "./operator-core-request.js";
import {
  productionAudienceOptions,
  productionAudiencePreview,
  productionDraft,
} from "./operator-production-json.js";
import { object, uuid } from "./operator-production-json-values.js";
import type {
  ProductionAudienceOptionsResult,
  ProductionAudiencePreviewInput,
  ProductionAudiencePreviewResult,
  ProductionDraftCreateInput,
  ProductionDraftReadInput,
  ProductionDraftResult,
} from "./operator-production-types.js";

export interface ProductionDraftClient {
  createProductionDraft(
    input: ProductionDraftCreateInput,
  ): Promise<ProductionDraftResult>;
  readProductionDraft(
    input: ProductionDraftReadInput,
  ): Promise<ProductionDraftResult>;
  listProductionAudienceOptions(
    input: Pick<ProductionDraftReadInput, "workspace">,
  ): Promise<ProductionAudienceOptionsResult>;
  previewProductionAudience(
    input: ProductionAudiencePreviewInput,
  ): Promise<ProductionAudiencePreviewResult>;
}

export function createProductionDraftClient(
  request: CoreRequester,
): ProductionDraftClient {
  return {
    async createProductionDraft(input) {
      const value = await request(
        `${workspacePath(input.workspace)}/broadcast-drafts?environment=production`,
        {
          idempotencyKey: input.idempotencyKey,
          lostResponseEffect: "unknown",
          body: {
            title: input.title,
            sender: input.senderProfileId,
            replyTo: input.replyTo,
            audienceKind: input.audience.kind,
            audienceContactImportBatchId: null,
            recipientExpression: input.audience.expression,
            communicationPurposeId: input.communicationPurposeId,
            subscriptionName: null,
            subject: input.subject,
            preheader: input.preheader,
            textBody: input.body,
          },
        },
      );
      const result = parse(productionDraft, value, "unknown");
      if (result.draft_id !== input.idempotencyKey || result.outcome === null)
        invalid("unknown");
      return result;
    },
    async readProductionDraft(input) {
      const value = await request(
        `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}?environment=production`,
      );
      const result = parse(productionDraft, value);
      if (result.draft_id !== input.draftId || result.outcome !== null)
        invalid("none");
      return { ...result, latest_test_id: latestTestId(value) };
    },
    async listProductionAudienceOptions(input) {
      return parse(
        productionAudienceOptions,
        await request(
          `${workspacePath(input.workspace)}/audience-options?environment=production`,
        ),
      );
    },
    async previewProductionAudience(input) {
      const result = parse(
        productionAudiencePreview,
        await request(
          `${workspacePath(input.workspace)}/broadcast-drafts/${segment(input.draftId)}/audience-preview?environment=production`,
        ),
      );
      if (result.draft_id !== input.draftId) invalid("none");
      return result;
    },
  };
}

function latestTestId(value: unknown): string | null {
  try {
    const id = object(object(value).draft).latestTestMarketingBroadcastId;
    return id === null ? null : uuid(id);
  } catch {
    return invalid("none");
  }
}

function workspacePath(workspace: string): string {
  return `/v1/workspaces/${segment(workspace)}`;
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
