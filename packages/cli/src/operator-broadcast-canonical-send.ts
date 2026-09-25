import { CoreOperatorError, type CoreRequester } from "./operator-core-request.js";

export interface CanonicalSendReview {
  readonly preparation: {
    readonly commandId: string;
    readonly expectedDraftVersion: number;
    readonly audienceSnapshotId: string;
    readonly purposePolicyGeneration: "contacts_marketing_subscription.v1";
    readonly activeSource: "composer" | "html";
    readonly clickTrackingEnabled: true;
    readonly engagementTrackingEnabled: true;
    readonly deliveryRequirements: {
      readonly geography: readonly [];
      readonly dataResidency: readonly [];
      readonly ipCommitment: "either";
      readonly maximumDeliveryDelaySeconds: 3600;
      readonly excludedProviderIdentities: readonly [];
      readonly encryption: "tls_required";
      readonly loggingPolicy: "delivery_events_v1";
      readonly promisedProviderRouteVersion: null;
      readonly commercialPriceAssumptions: {
        readonly priceVersion: string;
        readonly currency: string;
        readonly maximumUnitPriceMicros: string;
      };
    };
  };
  readonly timing: { readonly notBefore: string; readonly expiresAt: string };
  readonly sendPlanId: string;
  readonly broadcastId: string;
  readonly recipientCount: number;
  readonly commercialGrantId: string;
  readonly acceptedCandidateDigest: string;
  readonly acceptedReviewDigest: string;
}

export interface CanonicalSendStatus {
  readonly schema: "broadcast_send_operation";
  readonly operationId: string;
  readonly workspaceId: string;
  readonly environment: "production";
  readonly draftId: string;
  readonly draftVersion: number;
  readonly broadcastId: string;
  readonly sendPlanId: string;
  readonly recipientCount: number;
  readonly phase: "scheduled" | "sending" | "paused" | "complete" | "ended";
  readonly accepted: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unknown: number;
  readonly pending: number;
  readonly executionAuthorized: true;
  readonly replayed: boolean;
}

interface CanonicalAdmissionReceipt {
  readonly schema: "broadcast_send_operation";
  readonly operationId: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly broadcastId: string;
  readonly sendPlanId: string;
  readonly recipientCount: number;
  readonly executionAuthorized: true;
  readonly replayed: boolean;
}

export interface CanonicalBroadcastClient {
  prepare(input: { readonly workspace: string; readonly draftId: string;
    readonly revision: number; readonly activeSource: "composer" | "html";
    readonly requestId: string }): Promise<{ readonly status: "preparing" }
      | { readonly status: "ready"; readonly review: CanonicalSendReview;
        readonly renderedArtifactId: string; readonly renderedArtifactDigest: string }>;
  send(input: { readonly workspace: string; readonly draftId: string;
    readonly requestId: string; readonly review: CanonicalSendReview }): Promise<CanonicalSendStatus>;
  read(input: { readonly workspace: string; readonly draftId: string }): Promise<CanonicalSendStatus | null>;
}

export function createCanonicalBroadcastClient(request: CoreRequester): CanonicalBroadcastClient {
  const read = async (input: { readonly workspace: string; readonly draftId: string }) => {
    const body = object(await request(`${draftPath(input)}/send-intent?environment=production`));
    if (body.status === "absent") return null;
    if (body.status !== "accepted") invalid("broadcast_send_readback_invalid");
    return status(body.operation, input);
  };
  return {
    read,
    async prepare(input) {
      const path = `${draftPath(input)}/audience-preparation?environment=production`;
      const result = object(await request(path));
      const operation = result.status === "accepted" ? object(result.operation) : null;
      if (operation?.state === "failed" || operation?.state === "cancelled") {
        const failure = operation.failure && typeof operation.failure === "object"
          ? (operation.failure as Record<string, unknown>).code : null;
        invalid(typeof failure === "string" ? failure : "broadcast_audience_preparation_failed");
      }
      if (operation?.state !== "ready" || operation.phase !== "ready"
        || object(operation.populationCompatibility).status !== "compatible"
        || !operation.resultRoot || !operation.resultManifest) {
        if (operation && ["queued", "running", "cancel_requested"].includes(String(operation.state))) {
          return { status: "preparing" };
        }
        await request(path, { body: { schema: "audience_preparation_command.v1",
          requestId: input.requestId, expectedDraftVersion: input.revision },
          idempotencyKey: input.requestId, lostResponseEffect: "unknown" });
        return { status: "preparing" };
      }
      const root = object(operation.resultRoot);
      if (typeof root.rootId !== "string" || !root.rootId.startsWith("contact_prepared_audience:v2:")) {
        invalid("broadcast_audience_not_execution_ready");
      }
      const authority = object(await request(`${workspacePath(input.workspace)}/billing/payment-method?environment=production&view=commercial_authority`));
      const disclosure = object(authority.disclosure);
      const price = { priceVersion: required(disclosure.priceGeneration),
        currency: required(disclosure.currency), maximumUnitPriceMicros: required(disclosure.unitPriceMicros) };
      const preparation: CanonicalSendReview["preparation"] = {
        commandId: input.requestId, expectedDraftVersion: input.revision,
        audienceSnapshotId: root.rootId,
        purposePolicyGeneration: "contacts_marketing_subscription.v1",
        activeSource: input.activeSource, clickTrackingEnabled: true,
        engagementTrackingEnabled: true,
        deliveryRequirements: { geography: [], dataResidency: [], ipCommitment: "either",
          maximumDeliveryDelaySeconds: 3600, excludedProviderIdentities: [],
          encryption: "tls_required", loggingPolicy: "delivery_events_v1",
          promisedProviderRouteVersion: null, commercialPriceAssumptions: price },
      };
      const now = Date.now();
      const timing = { notBefore: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 3_599_000).toISOString() };
      const quote = object(await request(`${draftPath(input)}/send-plan?environment=production`, {
        body: { ...preparation, commercial: { action: "quote", timing } },
        lostResponseEffect: "unknown" }));
      const plan = object(quote.plan), commercial = object(quote.commercial);
      const review = object(commercial.review), candidate = object(review.candidate);
      const counts = object(plan.counts);
      const artifact = object(plan.messageArtifact);
      const preparedArtifact = object(object(quote.message).messageArtifact);
      const rendered = object(preparedArtifact.renderContent);
      if (quote.status !== "prepared" || commercial.status !== "review_required"
        || plan.commandId !== input.requestId || plan.draftVersion !== input.revision
        || plan.draftId !== input.draftId || plan.sendPlanId !== plan.broadcastAuthorizationId
        || artifact.id !== preparedArtifact.messageArtifactId
        || artifact.digest !== preparedArtifact.artifactDigest
        || typeof rendered.subject !== "string" || !rendered.subject
        || typeof rendered.html !== "string" || !rendered.html
        || !Number.isSafeInteger(counts.authorized) || Number(counts.authorized) < 1) {
        invalid("broadcast_send_review_mismatch");
      }
      return { status: "ready", renderedArtifactId: required(artifact.id),
        renderedArtifactDigest: required(artifact.digest), review: {
        preparation, timing, sendPlanId: required(plan.sendPlanId),
        broadcastId: required(plan.broadcastId), recipientCount: Number(counts.authorized),
        commercialGrantId: required(review.commercialGrantId),
        acceptedCandidateDigest: required(candidate.authorizationCandidateDigest),
        acceptedReviewDigest: required(review.reviewDigest),
      } };
    },
    async send(input) {
      const prior = await read(input);
      if (prior) return sameOperation(prior, input) ? { ...prior, replayed: true }
        : invalid("broadcast_send_intent_exists");
      const review = input.review;
      if (review.preparation.commandId !== input.requestId
        || review.preparation.audienceSnapshotId.length < 1
        || review.preparation.expectedDraftVersion < 1) invalid("broadcast_send_review_mismatch");
      const confirmed = object(await request(`${draftPath(input)}/send-plan?environment=production`, {
        body: { ...review.preparation, commercial: { action: "confirm", timing: review.timing,
          acceptedReviewDigest: review.acceptedReviewDigest } },
        lostResponseEffect: "unknown" }));
      const commercial = object(confirmed.commercial), result = object(commercial.result);
      const grant = object(result.grant), confirmation = object(commercial.review), plan = object(confirmed.plan);
      if (confirmed.status !== "prepared" || confirmed.executablePrepared !== true
        || commercial.status !== "grant_committed"
        || grant.commercialGrantId !== review.commercialGrantId
        || confirmation.reviewDigest !== review.acceptedReviewDigest
        || plan.sendPlanId !== review.sendPlanId || plan.broadcastId !== review.broadcastId
        || plan.draftVersion !== review.preparation.expectedDraftVersion) {
        invalid("broadcast_send_confirmation_mismatch");
      }
      const timing = Date.parse(review.timing.notBefore) > Date.now()
        ? { mode: "scheduled", notBefore: review.timing.notBefore } : { mode: "now" };
      try {
        const submitted = object(await request(`${draftPath(input)}/send-intent?environment=production`, {
          body: { schema: "broadcast_send_intent", requestId: input.requestId,
            sendPlanId: review.sendPlanId,
            expectedDraftVersion: review.preparation.expectedDraftVersion,
            commercialGrantId: review.commercialGrantId,
            acceptedCandidateDigest: review.acceptedCandidateDigest,
            acceptedReviewDigest: review.acceptedReviewDigest, timing },
          idempotencyKey: input.requestId, lostResponseEffect: "unknown" }));
        if (submitted.status !== "accepted") invalid("broadcast_send_receipt_invalid");
        const admitted = admission(submitted.operation, input);
        if (!sameOperation(admitted, input) || submitted.replayed !== admitted.replayed) {
          invalid("broadcast_send_receipt_identity_mismatch");
        }
        let observed: CanonicalSendStatus | null;
        try { observed = await read(input); }
        catch { throw new CoreOperatorError("broadcast_send_readback_unavailable", null, "unknown"); }
        if (!observed || !sameOperation(observed, input)
          || observed.operationId !== admitted.operationId) {
          invalid("broadcast_send_readback_mismatch");
        }
        return { ...observed, replayed: admitted.replayed };
      } catch (error) {
        if (!(error instanceof CoreOperatorError) || error.coreEffect !== "unknown") throw error;
        let observed: CanonicalSendStatus | null;
        try { observed = await read(input); }
        catch { throw error; }
        if (observed && sameOperation(observed, input)) return { ...observed, replayed: true };
        throw error;
      }
    },
  };
}

function sameOperation(operation: CanonicalAdmissionReceipt, input: {
  readonly draftId: string; readonly review: CanonicalSendReview;
}): boolean {
  return operation.draftId === input.draftId
    && operation.sendPlanId === input.review.sendPlanId
    && operation.broadcastId === input.review.broadcastId
    && operation.draftVersion === input.review.preparation.expectedDraftVersion
    && operation.recipientCount === input.review.recipientCount;
}

function admission(value: unknown, input: { readonly draftId: string }): CanonicalAdmissionReceipt {
  const row = object(value);
  if (row.schema !== "broadcast_send_operation" || row.draftId !== input.draftId
    || row.environment !== "production" || row.executionAuthorized !== true
    || typeof row.operationId !== "string" || row.operationId !== row.sendPlanId
    || typeof row.broadcastId !== "string" || !Number.isSafeInteger(row.draftVersion)
    || !Number.isSafeInteger(row.recipientCount) || Number(row.recipientCount) < 1
    || typeof row.replayed !== "boolean") invalid("broadcast_send_receipt_invalid");
  return row as unknown as CanonicalAdmissionReceipt;
}

function status(value: unknown, input: { readonly draftId: string }): CanonicalSendStatus {
  const row = object(value);
  if (row.schema !== "broadcast_send_operation" || row.draftId !== input.draftId
    || row.environment !== "production" || row.executionAuthorized !== true
    || typeof row.operationId !== "string" || row.operationId !== row.sendPlanId
    || !["scheduled", "sending", "paused", "complete", "ended"].includes(String(row.phase))
    || !Number.isSafeInteger(row.recipientCount) || Number(row.recipientCount) < 1) {
    invalid("broadcast_send_receipt_invalid");
  }
  return row as unknown as CanonicalSendStatus;
}

function draftPath(input: { readonly workspace: string; readonly draftId: string }): string {
  return `${workspacePath(input.workspace)}/broadcast-drafts/${encodeURIComponent(input.draftId)}`;
}
function workspacePath(workspace: string): string {
  return `/v1/workspaces/${encodeURIComponent(workspace)}`;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("core_operator_receipt_invalid");
  return value as Record<string, unknown>;
}
function required(value: unknown): string {
  if (typeof value !== "string" || !value) invalid("core_operator_receipt_invalid");
  return value;
}
function invalid(reason: string): never { throw new CoreOperatorError(reason, null, "none"); }
