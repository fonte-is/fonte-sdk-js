import { CoreOperatorError, parseCoreReceipt, type CoreRequester } from "./operator-core-request.js";
import { broadcastPersonalizationSchemaResultSchema, broadcastPersonalizationPreviewResultSchema,
  personalizationSampleSchema, type BroadcastPersonalizationSchemaInput, type BroadcastPersonalizationSchemaResult,
  type BroadcastPersonalizationPreviewInput, type BroadcastPersonalizationPreviewResult } from "./operator-broadcast-personalization-types.js";

export interface BroadcastPersonalizationClient {
  readBroadcastPersonalizationSchema(input: BroadcastPersonalizationSchemaInput): Promise<BroadcastPersonalizationSchemaResult>;
  previewBroadcastPersonalization(input: BroadcastPersonalizationPreviewInput): Promise<BroadcastPersonalizationPreviewResult>;
}

/** Expressions never pass through a local parser, generator or filter implementation. */
export function createBroadcastPersonalizationClient(request: CoreRequester): BroadcastPersonalizationClient {
  return {
    async readBroadcastPersonalizationSchema(input) {
      exactInput(input, ["workspace", "environment"]);
      const environment = input.environment ?? "production";
      const result = parseCoreReceipt(value => broadcastPersonalizationSchemaResultSchema.parse(value),
        await request(`${base(input.workspace)}/personalization-schema?environment=${environment}`));
      if (result.environment !== environment) invalidReceipt();
      return result;
    },
    async previewBroadcastPersonalization(input) {
      exactInput(input, ["workspace", "environment", "draftId", "revision", "schemaVersion", "sample"]);
      const sample = personalizationSampleSchema.parse(input.sample);
      const environment = input.environment ?? "production";
      const result = parseCoreReceipt(value => broadcastPersonalizationPreviewResultSchema.parse(value),
        await request(`${base(input.workspace)}/${encodeURIComponent(input.draftId)}/send-approvals?environment=${environment}`, {
          lostResponseEffect: "none", body: { operation: "render_personalization_preview",
            expectedVersion: input.revision, schemaVersion: input.schemaVersion, sample },
        }));
      if (result.environment !== environment || result.broadcastDraftId !== input.draftId
        || result.draftVersion !== input.revision || result.schema.schemaVersion !== input.schemaVersion
        || result.manifest.schemaVersion !== result.schema.schemaVersion
        || JSON.stringify(result.sample) !== JSON.stringify(sample)) invalidReceipt();
      if (result.status === "valid") {
        const proof = result.preview.renderProof;
        if (proof.templateRevision !== result.schema.templateRevision || proof.rendererVersion !== result.schema.rendererVersion
          || proof.recipientSlotSchemaVersion !== result.schema.schemaVersion || proof.finalizerVersion !== result.schema.finalizerVersion
          || proof.broadcastVersion !== input.revision || proof.renderHash !== result.preview.renderContentDigest
          || result.preview.broadcastDraftId !== input.draftId || result.preview.environment !== environment
          || result.preview.sampleRender.finalizerVersion !== proof.finalizerVersion
          || result.preview.sampleRender.valueSource.kind !== sample.kind
          || (sample.kind === "selected_contact" && (result.preview.sampleRender.valueSource.kind !== "selected_contact"
            || result.preview.sampleRender.valueSource.contactId !== sample.contactId))) invalidReceipt();
      }
      return result;
    },
  };
}

function base(workspace: string): string {
  return `/v1/workspaces/${encodeURIComponent(workspace)}/marketing-broadcasts`;
}
function exactInput(input: object, keys: readonly string[]): void {
  if (Object.keys(input).some(key => !keys.includes(key))) {
    throw new CoreOperatorError("broadcast_personalization_input_invalid", null, "none");
  }
  if ("environment" in input && input.environment !== undefined
    && input.environment !== "production" && input.environment !== "sandbox") {
    throw new CoreOperatorError("broadcast_personalization_input_invalid", null, "none");
  }
}
function invalidReceipt(): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
}
