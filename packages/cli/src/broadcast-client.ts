import type {
  BroadcastReceipt,
  BroadcastRequestStore,
  BroadcastReviewReceipt,
  BroadcastReviewRequest,
  BroadcastScope,
  BroadcastSendReceipt,
  BroadcastSendRequest,
  BroadcastSendStatus,
  ResolvedBroadcastScope,
  SavedBroadcastRequest,
} from "./broadcast-contracts.js";
import {
  createCoreRequester,
  CoreOperatorError,
  validateCoreRequestUrl,
  type CoreRequester,
} from "./operator-core-request.js";
import {
  parseBroadcastReviewReceipt,
  parseBroadcastSendReceipt,
  parseBroadcastSendStatus,
} from "./broadcast-receipts.js";
import {
  BROADCAST_CONTROL_BYTES,
  broadcastScopeSchema,
  broadcastText,
  parseBroadcastReviewRequest,
  parseBroadcastSendRequest,
  parseSavedBroadcastRequest,
  request,
  sameBroadcastInput,
} from "./broadcast-validation.js";

export interface BroadcastClientOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer?: string;
  readonly fetch?: typeof fetch;
  /** Existing current-custody authenticated requester; configured for <=64KiB responses.
   * Every BG call still explicitly carries the command's transport ceiling. */
  readonly request?: CoreRequester;
  readonly store: BroadcastRequestStore;
  /** Existing authenticated workspace catalog/context resolves the CLI code to the immutable ID. */
  readonly resolveWorkspaceId: (
    workspace: string,
    requestTimeoutMs: number,
  ) => Promise<string>;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
}
export interface BroadcastClient {
  review(
    scope: BroadcastScope,
    input: BroadcastReviewRequest,
  ): Promise<BroadcastReviewReceipt>;
  send(
    scope: BroadcastScope,
    input: BroadcastSendRequest,
  ): Promise<BroadcastSendReceipt>;
  recover(
    requestId: string,
  ): Promise<BroadcastReviewReceipt | BroadcastSendReceipt>;
  readReview(
    scope: BroadcastScope,
    operationUri: string,
    timeoutMs?: number,
    expectedDraftVersion?: number,
  ): Promise<BroadcastReviewReceipt>;
  readSend(
    scope: BroadcastScope,
    operationUri: string,
    timeoutMs?: number,
  ): Promise<BroadcastSendStatus>;
}
export function createBroadcastClient(
  options: BroadcastClientOptions,
): BroadcastClient {
  const coreOrigin = new URL(
    validateCoreRequestUrl("/", options.coreApiBaseUrl),
  ).origin;
  const timeoutMs = options.requestTimeoutMs ?? 60_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647
  )
    throw new CoreOperatorError("core_request_timeout_invalid", null, "none");
  const sendRequest =
    options.request ?? standaloneRequester(options, timeoutMs);
  const workspaceIds = new Map<string, Promise<string>>();
  async function resolvedScope(
    scope: BroadcastScope,
  ): Promise<ResolvedBroadcastScope> {
    const checked = request(() =>
      broadcastScopeSchema.parse({
        workspace: scope.workspace,
        environment: scope.environment,
        draftId: scope.draftId,
      }),
    );
    let pending = workspaceIds.get(checked.workspace);
    if (!pending) {
      pending = options.resolveWorkspaceId(checked.workspace, timeoutMs);
      workspaceIds.set(checked.workspace, pending);
    }
    const workspaceId = await pending;
    request(() => broadcastText.parse(workspaceId));
    if ("workspaceId" in scope && scope.workspaceId !== workspaceId)
      throw new CoreOperatorError(
        "broadcast_saved_input_scope_conflict",
        null,
        "none",
      );
    return { ...checked, workspaceId };
  }
  async function submit(
    saved: SavedBroadcastRequest,
  ): Promise<BroadcastReviewReceipt | BroadcastSendReceipt> {
    const checked = parseSavedBroadcastRequest(saved);
    if (checked.coreOrigin !== coreOrigin)
      throw new CoreOperatorError(
        "broadcast_saved_input_origin_conflict",
        null,
        "none",
      );
    if ((await resolvedScope(checked)).workspaceId !== checked.workspaceId)
      throw new CoreOperatorError(
        "broadcast_saved_input_scope_conflict",
        null,
        "none",
      );
    const durable = parseSavedBroadcastRequest(
      await options.store.persist(checked),
    );
    if (!sameBroadcastInput(durable, checked))
      throw new CoreOperatorError("broadcast_request_conflict", null, "none");
    const retired = await options.store.readSuperseded(
      durable.request.requestId,
    );
    if (retired) {
      const checkedRetirement = parseBroadcastSendReceipt(
        retired,
        coreOrigin,
        "none",
        durable,
      );
      if (
        checkedRetirement.outcome !== "rejected" ||
        checkedRetirement.blocker?.code !== "request_superseded"
      )
        throw new CoreOperatorError(
          "broadcast_saved_input_recover_review_required",
          null,
          "none",
        );
      return checkedRetirement;
    }
    const review = durable.request.schema === "broadcast_review_request.v1";
    const path = `/v1/workspaces/${encodeURIComponent(durable.workspace)}/broadcast-drafts/${encodeURIComponent(durable.draftId)}/${review ? "broadcast-review" : "send"}?environment=${durable.environment}`;
    const value = await sendRequest(path, {
      body: { ...durable.request },
      lostResponseEffect: "unknown",
      timeoutMs,
    });
    if (review)
      return parseBroadcastReviewReceipt(
        value,
        coreOrigin,
        durable,
        "unknown",
        durable.request.expectedDraftVersion,
      );
    const receipt = parseBroadcastSendReceipt(
      value,
      coreOrigin,
      "unknown",
      durable,
    );
    const instruction = parseBroadcastSendRequest(durable.request);
    if (
      (receipt.outcome === "executable" &&
        receipt.reviewId !== instruction.reviewId) ||
      (instruction.resume &&
        receipt.operationId !== instruction.resume.operationId)
    )
      throw new CoreOperatorError(
        "core_operator_receipt_invalid",
        null,
        "unknown",
      );
    if (receipt.blocker?.code === "request_superseded")
      await options.store.rememberSuperseded(
        durable.request.requestId,
        receipt,
      );
    return receipt;
  }
  async function saved(
    scope: BroadcastScope,
    input: BroadcastReviewRequest | BroadcastSendRequest,
  ): Promise<SavedBroadcastRequest> {
    return {
      ...(await resolvedScope(scope)),
      schema: "fonte_broadcast_request.v1",
      coreOrigin,
      request: input,
    };
  }
  return {
    async review(scope, input) {
      return (await submit(
        await saved(scope, parseBroadcastReviewRequest(input)),
      )) as BroadcastReviewReceipt;
    },
    async send(scope, input) {
      return (await submit(
        await saved(scope, parseBroadcastSendRequest(input)),
      )) as BroadcastSendReceipt;
    },
    async recover(requestId) {
      // Replaying the exact immutable key works both before and after a lost response.
      // An immediate absent GET never proves that the original POST cannot still commit.
      return submit(await options.store.read(requestId));
    },
    async readReview(scope, operationUri, timeoutMs, expectedDraftVersion) {
      const resolved = await resolvedScope(scope);
      return parseBroadcastReviewReceipt(
        await sendRequest(validateCoreRequestUrl(operationUri, coreOrigin), {
          timeoutMs: Math.min(
            timeoutMs ?? options.requestTimeoutMs ?? 60_000,
            options.requestTimeoutMs ?? 60_000,
          ),
        }),
        coreOrigin,
        resolved,
        "none",
        expectedDraftVersion,
      );
    },
    async readSend(scope, operationUri, timeoutMs) {
      const resolved = await resolvedScope(scope);
      return parseBroadcastSendStatus(
        await sendRequest(validateCoreRequestUrl(operationUri, coreOrigin), {
          timeoutMs: Math.min(
            timeoutMs ?? options.requestTimeoutMs ?? 60_000,
            options.requestTimeoutMs ?? 60_000,
          ),
        }),
        coreOrigin,
        resolved,
      );
    },
  };
}
function standaloneRequester(
  options: BroadcastClientOptions,
  timeoutMs: number,
): CoreRequester {
  if (!options.fetch || !options.bearer)
    throw new CoreOperatorError(
      "broadcast_authenticated_requester_missing",
      null,
      "none",
    );
  return createCoreRequester({
    coreApiBaseUrl: options.coreApiBaseUrl,
    fetch: options.fetch,
    bearer: options.bearer,
    signal: options.signal,
    timeoutMs,
    maxResponseBytes: BROADCAST_CONTROL_BYTES,
  });
}
export interface BroadcastWaitOptions {
  readonly foregroundWaitMs: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly expectedDraftVersion?: number;
}
export interface BroadcastWaitResult {
  readonly pending: boolean;
  readonly receipt: BroadcastReceipt;
}
/** Read-only bounded foreground observation; no Send, quote, grant or detached task. */
export async function waitForBroadcastOperation(
  client: BroadcastClient,
  scope: BroadcastScope,
  initial: BroadcastReceipt,
  options: BroadcastWaitOptions,
): Promise<BroadcastWaitResult> {
  const now = options.now ?? Date.now;
  const interval = options.pollIntervalMs ?? 1000;
  if (
    !Number.isSafeInteger(options.foregroundWaitMs) ||
    options.foregroundWaitMs < 0 ||
    !Number.isSafeInteger(interval) ||
    interval < 1
  )
    throw new CoreOperatorError("broadcast_wait_invalid", null, "none");
  const deadline = now() + options.foregroundWaitMs;
  let receipt = initial;
  while (isPending(receipt)) {
    const remaining = deadline - now();
    if (remaining <= 0) return { pending: true, receipt };
    await options.sleep(Math.min(interval, remaining));
    if (now() >= deadline) return { pending: true, receipt };
    try {
      const readBudget = Math.max(1, Math.ceil(deadline - now()));
      receipt =
        "state" in receipt
          ? await client.readReview(
              scope,
              receipt.operationUri,
              readBudget,
              options.expectedDraftVersion,
            )
          : await client.readSend(scope, receipt.operationUri, readBudget);
      if (
        receipt.operationId !== initial.operationId ||
        receipt.operationVersion < initial.operationVersion
      )
        throw new CoreOperatorError(
          "core_operator_receipt_invalid",
          null,
          "none",
        );
    } catch (error) {
      if (
        error instanceof CoreOperatorError &&
        error.reason === "core_api_unavailable"
      )
        return { pending: true, receipt };
      throw error;
    }
  }
  return { pending: false, receipt };
}
function isPending(receipt: BroadcastReceipt): boolean {
  return "state" in receipt
    ? receipt.state === "queued" || receipt.state === "running"
    : receipt.outcome === "processing";
}
