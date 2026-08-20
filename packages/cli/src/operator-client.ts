import {
  queuedSandboxTest,
  resendBridgeCopy,
  resendBridgePreview,
  sandboxTest,
} from "./operator-json.js";
import {
  createCoreRequester,
  CoreOperatorError,
} from "./operator-core-request.js";
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
export { CoreOperatorError } from "./operator-core-request.js";

export interface CoreOperatorClientOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
}

export interface CoreOperatorClient {
  sendSandboxTest(input: SandboxTestSendInput): Promise<SandboxTestResult>;
  readSandboxTest(input: SandboxTestReadInput): Promise<SandboxTestResult>;
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
      return parseCurrent(queuedSandboxTest, response, "unknown");
    },
    async readSandboxTest(input) {
      return parseCurrent(
        sandboxTest,
        await request(
          `/v1/workspaces/${segment(input.workspace)}/email-sandbox/canaries/${segment(input.testId)}?environment=sandbox`,
        ),
      );
    },
    async previewResendSegment(input) {
      const result = parseCurrent(
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
      const result = parseCurrent(
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

function parseCurrent<T>(
  parser: (value: unknown) => T,
  value: unknown,
  coreEffect: "none" | "unknown" = "none",
): T {
  try {
    return parser(value);
  } catch {
    throw new CoreOperatorError(
      "core_operator_receipt_invalid",
      null,
      coreEffect,
    );
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
