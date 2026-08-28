import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { providerRotationReceipt } from "./operator-provider-rotation-json.js";
import type {
  ProviderRotationAdvanceInput,
  ProviderRotationReadInput,
  ProviderRotationResult,
  ProviderRotationSealInput,
  ProviderRotationStartInput,
} from "./operator-provider-rotation-types.js";

export interface ProviderRotationClient {
  startProviderRotation(
    input: ProviderRotationStartInput,
  ): Promise<ProviderRotationResult>;
  advanceProviderRotation(
    input: ProviderRotationAdvanceInput,
  ): Promise<ProviderRotationResult>;
  readProviderRotation(
    input: ProviderRotationReadInput,
  ): Promise<ProviderRotationResult>;
  sealProviderRotation(
    input: ProviderRotationSealInput,
  ): Promise<ProviderRotationResult>;
}

export function createProviderRotationClient(
  request: CoreRequester,
): ProviderRotationClient {
  return {
    async startProviderRotation(input) {
      return checked(
        input,
        await mutate(request, input, "start", {
          iterationId: input.iterationId,
          connectionId: input.connectionId,
          candidateOperationId: input.candidateOperationId,
          outgoingCandidateOperationId: input.outgoingCandidateOperationId,
          populationSelectorGenerationId: input.populationSelectorGenerationId,
          placementSegmentId: input.placementSegmentId,
          qualifyingBroadcastId: input.qualifyingBroadcastId,
          orderedBroadcastIds: input.orderedBroadcastIds,
          coldRemaining: input.coldRemaining,
          identityCustody: input.identityCustody,
        }),
      );
    },
    async advanceProviderRotation(input) {
      return checked(
        input,
        await mutate(request, input, "advance", {
          iterationId: input.iterationId,
          expectedPageNumber: input.expectedPageNumber,
        }),
      );
    },
    async readProviderRotation(input) {
      const path =
        `${base(input)}/rotation-progress/${segment(input.iterationId)}` +
        `?environment=${input.environment}`;
      return checked(
        input,
        parseCoreReceipt(providerRotationReceipt, await request(path)),
      );
    },
    async sealProviderRotation(input) {
      return checked(
        input,
        await mutate(request, input, "seal", {
          iterationId: input.iterationId,
          candidateGenerationId: input.candidateGenerationId,
          partitionGenerationId: input.partitionGenerationId,
          qualifyingBroadcastId: input.qualifyingBroadcastId,
          orderedBroadcastIds: input.orderedBroadcastIds,
        }),
      );
    },
  };
}

async function mutate(
  request: CoreRequester,
  input: ProviderRotationReadInput,
  operation: "start" | "advance" | "seal",
  body: Record<string, unknown>,
): Promise<ProviderRotationResult> {
  return parseCoreReceipt(
    providerRotationReceipt,
    await request(
      `${base(input)}/rotation-${operation}?environment=${input.environment}`,
      { body, lostResponseEffect: "unknown" },
    ),
    "unknown",
  );
}

function checked(
  input: ProviderRotationReadInput & { readonly connectionId?: string },
  result: ProviderRotationResult,
): ProviderRotationResult {
  if (
    result.iterationId !== uuid(input.iterationId) ||
    result.environment !== input.environment ||
    (input.connectionId && result.connectionId !== uuid(input.connectionId))
  ) {
    throw new CoreOperatorError(
      "core_operator_receipt_invalid",
      null,
      "unknown",
    );
  }
  return result;
}

function base(input: ProviderRotationReadInput): string {
  if (input.environment !== "sandbox" && input.environment !== "production")
    invalid();
  return `/v1/workspaces/${encodeURIComponent(input.workspace)}/bridge/audience`;
}

function uuid(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) invalid();
  return value.toLowerCase();
}

function segment(value: string): string {
  return encodeURIComponent(uuid(value));
}

function invalid(): never {
  throw new CoreOperatorError(
    "provider_rotation_partition_request_invalid",
    null,
    "none",
  );
}
