import {
  queuedSandboxTest,
  resendBridgeCopy,
  resendBridgePreview,
  sandboxTest,
} from "./operator-json.js";
import {
  createCoreRequester,
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";
import {
  createProviderAudienceClient,
  type ProviderAudienceClient,
} from "./operator-provider-audience-client.js";
import {
  createProviderConnectionClient,
  type ProviderConnectionClient,
} from "./operator-provider-connection-client.js";
import {
  requestBroadcastPreflight,
  type BroadcastPreflightInput,
} from "./operator-preflight-client.js";
import type { BroadcastPreflightResult } from "./operator-preflight-types.js";
import {
  createProductionOperatorClient,
  type ProductionOperatorClient,
} from "./operator-production-client.js";
import type {
  ResendBridgeCopyResult,
  ResendBridgePreviewResult,
  SandboxTestResult,
} from "./operator-types.js";

export type {
  OperatorCommand,
  OperatorReceipt,
  ResendBridgeCopyResult,
  ResendBridgePreviewResult,
} from "./operator-types.js";
export type { BroadcastPreflightInput } from "./operator-preflight-client.js";
export type { BroadcastPreflightResult } from "./operator-preflight-types.js";
export type {
  ContactImportStatusInput,
  ContactImportStatusResult,
  FonteAudienceReferenceInput,
  ProviderAudienceCountsResult,
  ProviderAudienceFreezeInput,
  ProviderAudienceFreezeResult,
  ProviderAudienceReconcileInput,
  ProviderAudienceReconciliationResult,
  ProviderAudienceSourceInput,
  ProviderCollectionListInput,
  ProviderCollectionListResult,
  ProviderCollectionReferenceInput,
} from "./operator-provider-audience-types.js";
export type {
  ProviderConnectionListInput,
  ProviderConnectionListResult,
  ProviderConnectionMetadataResult,
  ProviderConnectionOAuthBeginInput,
  ProviderConnectionOAuthReadInput,
  ProviderConnectionOAuthResult,
  ProviderConnectionProvider,
} from "./operator-provider-connection-types.js";
export type {
  AudienceReuseOverrideInput,
  ProductionAudienceInput,
  ProductionAudienceOptionsResult,
  ProductionAudiencePreviewResult,
  ProductionAuthorizeInput,
  ProductionBroadcastControlInput,
  ProductionBroadcastProgressResult,
  ProductionBroadcastReadInput,
  ProductionBroadcastResult,
  ProductionDraftCreateInput,
  ProductionDraftReadInput,
  ProductionDraftResult,
  ProductionTestReadInput,
  ProductionTestResult,
  ProductionTestSendInput,
  QueuedBroadcastResult,
  RecipientExpressionInput,
  RecipientReferenceInput,
} from "./operator-production-types.js";
export { CoreOperatorError } from "./operator-core-request.js";

export interface CoreOperatorClientOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
}

export interface CoreOperatorClient
  extends
    ProductionOperatorClient,
    ProviderAudienceClient,
    ProviderConnectionClient {
  sendSandboxTest(input: SandboxTestSendInput): Promise<SandboxTestResult>;
  readSandboxTest(input: SandboxTestReadInput): Promise<SandboxTestResult>;
  preflightBroadcast(
    input: BroadcastPreflightInput,
  ): Promise<BroadcastPreflightResult>;
  previewResendSegment(
    input: ResendBridgePreviewInput,
  ): Promise<ResendBridgePreviewResult>;
  copyResendSegment(
    input: ResendBridgeCopyInput,
  ): Promise<ResendBridgeCopyResult>;
}

export interface SandboxTestSendInput {
  readonly workspace: string;
  readonly draftId: string;
  readonly revision: number;
  readonly idempotencyKey: string;
}

export interface SandboxTestReadInput {
  readonly workspace: string;
  readonly testId: string;
}

export interface ResendBridgePreviewInput {
  readonly workspace: string;
  readonly environment: "sandbox" | "production";
  readonly segmentId: string;
}

export interface ResendBridgeCopyInput extends ResendBridgePreviewInput {
  readonly expectedObservationFingerprint: string;
  readonly idempotencyKey: string;
}

export function createCoreOperatorClient(
  options: CoreOperatorClientOptions,
): CoreOperatorClient {
  const request = createCoreRequester(options);
  return {
    ...createProductionOperatorClient(request),
    ...createProviderAudienceClient(request),
    ...createProviderConnectionClient(request),
    async sendSandboxTest(input) {
      const response = await request(
        `/v1/workspaces/${segment(input.workspace)}/email-sandbox/canaries?environment=sandbox`,
        {
          idempotencyKey: input.idempotencyKey,
          body: {
            broadcastDraftId: input.draftId,
            draftVersion: input.revision,
            idempotencyKey: input.idempotencyKey,
          },
          lostResponseEffect: "unknown",
        },
      );
      return parseCoreReceipt(queuedSandboxTest, response, "unknown");
    },
    async readSandboxTest(input) {
      return parseCoreReceipt(
        sandboxTest,
        await request(
          `/v1/workspaces/${segment(input.workspace)}/email-sandbox/canaries/${segment(input.testId)}?environment=sandbox`,
        ),
      );
    },
    async preflightBroadcast(input) {
      return requestBroadcastPreflight(request, input);
    },
    async previewResendSegment(input) {
      const result = parseCoreReceipt(
        resendBridgePreview,
        await request(resendPath(input, "preview"), {
          body: {},
          lostResponseEffect: "none",
        }),
      );
      return matchingObservation(result, input, "none");
    },
    async copyResendSegment(input) {
      const expectedObservationFingerprint = bridgeFingerprint(
        input.expectedObservationFingerprint,
      );
      const idempotencyKey = bridgeIdempotencyKey(input.idempotencyKey);
      const result = parseCoreReceipt(
        resendBridgeCopy,
        await request(resendPath(input, "copy"), {
          body: {
            expectedObservationFingerprint,
            idempotencyKey,
          },
          idempotencyKey,
          lostResponseEffect: "unknown",
        }),
        "unknown",
      );
      const matched = matchingObservation(result, input, "unknown");
      if (matched.observation_fingerprint !== expectedObservationFingerprint) {
        invalidReceipt("unknown");
      }
      return matched;
    },
  };
}

function resendPath(
  input: ResendBridgePreviewInput,
  operation: "preview" | "copy",
): string {
  if (input.environment !== "sandbox" && input.environment !== "production")
    invalidRequest();
  const segmentId = providerSegmentId(input.segmentId);
  return `/v1/workspaces/${segment(input.workspace)}/bridge/resend/segments/${segment(segmentId)}/${operation}?environment=${input.environment}`;
}

function providerSegmentId(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 500 ||
    value.includes("/") ||
    /\p{Cc}/u.test(value)
  )
    invalidRequest();
  return value;
}

function bridgeFingerprint(value: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    invalidRequest();
  return value;
}

function bridgeIdempotencyKey(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 100 ||
    /\p{Cc}/u.test(value)
  )
    invalidRequest();
  return value;
}

function invalidRequest(): never {
  throw new CoreOperatorError("resend_bridge_request_invalid", null, "none");
}

function matchingObservation<
  T extends { readonly segment: { readonly id: string } },
>(
  result: T,
  input: ResendBridgePreviewInput,
  coreEffect: "none" | "unknown",
): T {
  if (result.segment.id !== input.segmentId) invalidReceipt(coreEffect);
  return result;
}

function invalidReceipt(coreEffect: "none" | "unknown"): never {
  throw new CoreOperatorError(
    "core_operator_receipt_invalid",
    null,
    coreEffect,
  );
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
