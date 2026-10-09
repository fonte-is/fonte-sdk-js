export type {
  ContactImportStatusInput,
  ContactImportStatusResult,
} from "./contact-import-types.js";
import {
  createConnectionClient,
  type ConnectionClient,
} from "./connection-client.js";
export * from "./connection-client.js";
import { queuedSandboxTest, sandboxTest } from "./operator-json.js";
import {
  createCoreRequester,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  createBroadcastSendInstructionClient,
  type BroadcastSendInstructionClient,
} from "./operator-broadcast-send-instruction-client.js";
import {
  CAMPAIGN_SEGMENT_RESPONSE_MAX_BYTES,
  createCampaignMetadataClient,
  type CampaignMetadataClient,
} from "./operator-campaign-client.js";
import {
  createSegmentMetadataClient,
  type SegmentMetadataClient,
} from "./operator-segment-client.js";
import {
  createWorkspaceMarketingSettingsClient,
  type WorkspaceMarketingSettingsClient,
} from "./operator-marketing-settings-client.js";

import {
  createWorkspaceInvitationClient,
  type WorkspaceInvitationClient,
} from "./operator-workspace-invitation-client.js";
import {
  createSequenceAuthoringClient,
  type SequenceAuthoringClient,
} from "./operator-sequence-client.js";
import {
  requestBroadcastPreflight,
  type BroadcastPreflightInput,
} from "./operator-preflight-client.js";
import type { BroadcastPreflightResult } from "./operator-preflight-types.js";
import {
  createProductionOperatorClient,
  type ProductionOperatorClient,
} from "./operator-production-client.js";
import type { SandboxTestResult } from "./operator-types.js";

export type { OperatorCommand, OperatorReceipt } from "./operator-types.js";
export type { BroadcastPreflightInput } from "./operator-preflight-client.js";
export type { BroadcastPreflightResult } from "./operator-preflight-types.js";
export type {
  AcceptBroadcastSendInput,
  AmendBroadcastSendApprovalInput,
  BroadcastSendAllowedAction,
  BroadcastSendDelivery,
  BroadcastSendOperation,
  BroadcastSendOperationPhase,
  BroadcastSendOperationResult,
  BroadcastSendTiming,
  BroadcastSpendLimitRequiredAction,
  CancelBroadcastSendInput,
  ReadBroadcastSendOperationInput,
  ReplaceBroadcastSendScheduleInput,
  ResolveBroadcastSpendLimitInput,
} from "./operator-broadcast-send-instruction-types.js";

export type {
  AudienceReuseOverrideInput,
  ProductionAudienceAppendBaselineResult,
  ProductionAudienceAppendInput,
  ProductionAudienceAppendPreflightResult,
  ProductionAudienceAppendResult,
  ProductionAudienceInput,
  ProductionAudienceOptionsResult,
  ProductionAudiencePreviewResult,
  ProductionAuthorizeInput,
  ProductionBroadcastControlInput,
  ProductionBroadcastProgressResult,
  ProductionBroadcastReadInput,
  ProductionBroadcastReleaseInput,
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
export type {
  WorkspaceContextResult,
  WorkspaceInvitationClaimInput,
  WorkspaceInvitationClaimResult,
  WorkspaceInvitationCreateInput,
  WorkspaceInvitationCreateResult,
  WorkspaceInvitationEnvironment,
  WorkspaceInvitationResult,
  WorkspaceInvitationRole,
  WorkspaceInvitationStatus,
  WorkspaceInvitationWorkspaceResult,
} from "./operator-workspace-invitation-client.js";
export type {
  SequenceActivateInput,
  SequenceActivationBinding,
  SequenceActivationBindingResult,
  SequenceActivationOutcome,
  SequenceActivationResult,
  SequenceActivationScope,
  SequenceActivationScopeResult,
  SequenceCreateInput,
  SequenceDiffInput,
  SequenceDiffResult,
  SequenceDraftResult,
  SequenceEnvironment,
  SequenceExportResult,
  SequenceJsonObject,
  SequenceJsonValue,
  SequenceListResult,
  SequenceMessageRenderReference,
  SequencePlan,
  SequencePlanStep,
  SequenceReadInput,
  SequenceSimulationInput,
  SequenceSimulationResult,
  SequenceUpdateInput,
  SequenceValidationInput,
  SequenceValidationResult,
} from "./operator-sequence-types.js";
export type {
  WorkspaceMarketingSettingsInput,
  WorkspaceMarketingSettingsResult,
} from "./operator-marketing-settings-types.js";
export { CoreOperatorError } from "./operator-core-request.js";

export interface CoreOperatorClientOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface CoreOperatorClient
  extends
    ProductionOperatorClient,
    ConnectionClient,
    WorkspaceInvitationClient,
    WorkspaceMarketingSettingsClient,
    SequenceAuthoringClient,
    BroadcastSendInstructionClient {
  readonly campaignMetadata: CampaignMetadataClient;
  readonly segmentMetadata: SegmentMetadataClient;
  sendSandboxTest(input: SandboxTestSendInput): Promise<SandboxTestResult>;
  readSandboxTest(input: SandboxTestReadInput): Promise<SandboxTestResult>;
  preflightBroadcast(
    input: BroadcastPreflightInput,
  ): Promise<BroadcastPreflightResult>;
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

export function createCoreOperatorClient(
  options: CoreOperatorClientOptions,
): CoreOperatorClient {
  const request = createCoreRequester({
    ...options,
    maxResponseBytes: CAMPAIGN_SEGMENT_RESPONSE_MAX_BYTES,
  });
  return createCoreOperatorClientWithRequester(request);
}

/** Composes operator clients over the caller's existing bounded requester. */
export function createCoreOperatorClientWithRequester(
  request: CoreRequester,
): CoreOperatorClient {
  return {
    ...createProductionOperatorClient(request),
    ...createConnectionClient(request),
    ...createWorkspaceInvitationClient(request),
    ...createWorkspaceMarketingSettingsClient(request),
    ...createSequenceAuthoringClient(request),
    ...createBroadcastSendInstructionClient(request),
    campaignMetadata: createCampaignMetadataClient(request),
    segmentMetadata: createSegmentMetadataClient(request),
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
  };
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
