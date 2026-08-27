export const draftId = "10000000-0000-4000-8000-000000000501";
export const purposeId = "10000000-0000-4000-8000-000000000502";
export const collectionId = "10000000-0000-4000-8000-000000000503";
export const testId = "10000000-0000-4000-8000-000000000504";
export const broadcastId = "10000000-0000-4000-8000-000000000505";
export const cancelledId = "10000000-0000-4000-8000-000000000506";
export const bearer = "synthetic.header.signature";
export const workspace = "northstar";
export const postalAddress = "1 Synthetic Way";
export const reuseIdentity = `sha256:${"a".repeat(64)}`;
export const textBody = "Hello synthetic subscribers";
export const htmlBody = "<p>Hello synthetic subscribers</p>";
export const providerMessageId = "provider-message-synthetic";

export function hostedConfig(coreApiBaseUrl) {
  return {
    schema: "fonte.cli.hosted_config.v1",
    authorizationServer: "https://auth.example.test",
    clientId: "fonte-cli-client-v0",
    coreApiBaseUrl,
    redirectUri: "http://127.0.0.1:49671/callback",
    scopes: ["email"],
  };
}

export function draftEnvelope(outcome, latestTestId = null) {
  return bound({
    outcome,
    draft: {
      broadcastDraftId: draftId,
      title: "Synthetic product update",
      sender: "sender-profile-v1",
      replyTo: null,
      audienceKind: "recipient_expression",
      audienceContactImportBatchId: null,
      recipientExpression: expression(),
      communicationPurposeId: purposeId,
      subscriptionName: "Product updates",
      subject: "August update",
      preheader: "Synthetic preheader",
      textBody: "<p>Hello synthetic subscribers</p>",
      version: 1,
      createdAt: "2026-08-20T18:00:00.000Z",
      updatedAt: "2026-08-20T18:00:00.000Z",
      latestTestMarketingBroadcastId: latestTestId,
    },
  });
}

export function audienceOptions() {
  return bound({
    communicationPurposes: [
      { communicationPurposeId: purposeId, label: "Product updates" },
    ],
    sources: [source()],
  });
}

export function audiencePreview() {
  return bound({
    broadcastDraftId: draftId,
    communicationPurposeId: purposeId,
    communicationPurposeName: "Product updates",
    audienceKind: "recipient_expression",
    recipientExpression: expression(),
    sourceProvenance: [source()],
    counts: {
      matched: 3,
      excluded: 0,
      ineligibleProtected: 1,
      unknown: 0,
      finalEligible: 2,
    },
  });
}

export function queued(kind) {
  return bound({
    broadcastDraftId: draftId,
    marketingBroadcastId: kind === "test" ? testId : broadcastId,
    recipientSnapshotId: `${kind}-snapshot`,
    sendPlanDecisionId: `${kind}-decision`,
    status: "queued",
    submittedCount: kind === "test" ? 1 : 3,
    acceptedCount: kind === "test" ? 1 : 2,
    refusedCount: kind === "test" ? 0 : 1,
    unknownCount: 0,
    created: true,
    ...(kind === "production" ? { audienceTargeting: frozenAudience() } : {}),
  });
}

export function testReadback(status) {
  const terminal = status === "terminal";
  return bound({
    broadcastDraftId: draftId,
    marketingBroadcastId: testId,
    deliveryKind: "test",
    statusScope: "provider_submission_and_billing",
    status,
    pollAfterMilliseconds: terminal ? null : 1,
    submittedCount: 1,
    acceptedCount: terminal ? 1 : 0,
    refusedCount: 0,
    unknownCount: terminal ? 0 : 1,
    billing: {
      acceptedUsageQuantity: terminal ? 1 : 0,
      usageRecordCount: terminal ? 1 : 0,
    },
    outbox: {
      providerMessageId: terminal ? providerMessageId : null,
    },
  });
}

export function preflight() {
  const ready = (evidence) => ({ status: "ready", reasonCode: null, evidence });
  return {
    schemaVersion: "broadcast_preflight.v1",
    workspaceId: "workspace-synthetic",
    workspaceSlug: workspace,
    environment: "production",
    broadcastDraftId: draftId,
    requestedDraftVersion: 1,
    confirmedDraftVersion: 1,
    observedAt: "2026-08-20T18:00:00.000Z",
    ready: true,
    blockers: [],
    checks: {
      draft: ready({ version: 1, updatedAt: "2026-08-20T18:00:00.000Z" }),
      rendering: ready(null),
      authorization: ready({
        renderContentDigest: "sha256:synthetic",
        senderId: "sender-profile-v1",
      }),
      sender: ready({ senderId: "sender-profile-v1" }),
      audience: ready(audiencePreview()),
      audienceReuse: ready({
        identity: {
          version: "audience_reuse_identity.v1",
          digest: reuseIdentity,
        },
        priorAuthorizationCount: 2,
        latestAuthorizedAt: "2026-08-20T17:30:00.000Z",
        overrideRequired: true,
        overrideAccepted: true,
      }),
      billing: ready({
        billingRequired: false,
        eligibleRecipientCount: 2,
        reasonCode: null,
      }),
      safetyFeedback: ready({ observedAt: "2026-08-20T17:59:59.000Z" }),
      providerCapacity: ready({
        region: "us-east-1",
        observedAt: "2026-08-20T17:59:59.000Z",
        max24HourSend: 100,
        effectiveSentLast24Hours: 10,
        dailyRemaining: 90,
        maxSendRate: 10,
        operatingSendsPerSecond: 5,
        providerHealth: "healthy",
      }),
    },
  };
}

export function progress(status, id = broadcastId) {
  const terminal = status === "terminal";
  const cancelled = status === "cancelled";
  const paused = status === "paused";
  return bound({
    marketingBroadcastId: id,
    status,
    controlState: cancelled ? "cancelled" : paused ? "paused" : "active",
    controlVersion: "3",
    progressVersion: terminal ? "4" : "3",
    requestedRecipientCount: 3,
    eligibleRecipientCount: 2,
    excludedRecipientCount: 1,
    pendingRecipientCount: terminal || cancelled ? 0 : 1,
    claimedRecipientCount: 0,
    acceptedRecipientCount: terminal ? 2 : 1,
    refusedRecipientCount: 0,
    unknownRecipientCount: 0,
    cancelledRecipientCount: cancelled ? 1 : 0,
    remainingRecipientCount: terminal || cancelled ? 0 : 1,
    currentRatePerSecond: status === "processing" ? 1 : null,
    asOf: "2026-08-20T18:00:01.000Z",
    estimatedCompletionAt:
      status === "processing" ? "2026-08-20T18:00:02.000Z" : null,
  });
}

export function finalResult() {
  return bound({
    broadcastDraftId: draftId,
    marketingBroadcastId: broadcastId,
    status: "terminal",
    requestedRecipientCount: 3,
    eligibleRecipientCount: 2,
    providerAcceptedCount: 2,
    refusedRecipientCount: 0,
    unknownRecipientCount: 0,
    pendingRecipientCount: 0,
    claimedRecipientCount: 0,
    cancelledRecipientCount: 0,
    deliveredCount: 2,
    acceptedEmailUsageQuantity: 2,
    billableAcceptedEmailQuantity: 0,
    unitPriceMicros: 750,
    accruedAmountMicros: 0,
    currency: "usd",
    audienceTargeting: frozenAudience(),
  });
}

export function reuseOverride() {
  return {
    version: "audience_reuse_override.v1",
    audienceIdentity: reuseIdentity,
    acknowledged: true,
  };
}

function frozenAudience() {
  return {
    communicationPurposeId: purposeId,
    communicationPurposeName: "Product updates",
    audienceKind: "recipient_expression",
    recipientExpression: expression(),
    sourceProvenance: [source()],
    matchedCount: 3,
    excludedCount: 0,
    ineligibleProtectedCount: 1,
    unknownCount: 0,
    finalEligibleCount: 2,
    reuseEvidence: {
      version: "audience_reuse_evidence.v1",
      identity: {
        version: "audience_reuse_identity.v1",
        digest: reuseIdentity,
      },
      priorAuthorizationCount: 2,
      latestAuthorizedAt: "2026-08-20T17:30:00.000Z",
      override: { version: "audience_reuse_override.v1", acknowledged: true },
    },
  };
}

function expression() {
  return { include: [{ kind: "collection", collectionId }], exclude: [] };
}

function source() {
  return {
    kind: "collection",
    collectionId,
    collectionKind: "segment",
    label: "Synthetic subscribers",
    sourceConnectionId: null,
    externalCollectionId: null,
    createdAt: "2026-08-20T17:00:00.000Z",
  };
}

function bound(value) {
  return {
    tenantId: "workspace-synthetic",
    environment: "production",
    ...value,
  };
}
