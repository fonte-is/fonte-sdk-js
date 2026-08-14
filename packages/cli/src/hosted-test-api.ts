import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import type { HostedTestDependencies } from "./runtime-types.js";

export interface ProviderTerminalResult {
  readonly providerSubmission: "accepted" | "refused" | "unknown";
  readonly providerMessageId: string | null;
  readonly providerErrorCode: string | null;
  readonly acceptedEmailUsageQuantity: number;
}

export async function createSandboxDraft(
  hosted: HostedConfig,
  workspace: string,
  token: string,
  fetcher: HostedTestDependencies["fetch"],
): Promise<{ draftId: string; version: number }> {
  const body = await requestJson(
    fetcher,
    draftCollection(hosted, workspace),
    token,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Fonte CLI sandbox proof",
        sender: null,
        audienceKind: null,
        subject: "Your Fonte sandbox email works",
        preheader: "Provider submission proof",
        textBody:
          "Fonte submitted this sandbox proof through your signed-in account.",
      }),
    },
  );
  const draft = objectValue(objectValue(body, "draft response").draft, "draft");
  return {
    draftId: uuid(draft.broadcastDraftId),
    version: positiveInteger(draft.version),
  };
}

export async function queueSandboxCanary(
  hosted: HostedConfig,
  workspace: string,
  token: string,
  draft: { draftId: string; version: number },
  idempotencyKey: string,
  fetcher: HostedTestDependencies["fetch"],
): Promise<string> {
  const body = await requestJson(
    fetcher,
    `${canaryCollection(hosted, workspace)}?environment=sandbox`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        broadcastDraftId: draft.draftId,
        draftVersion: draft.version,
        idempotencyKey,
      }),
    },
  );
  return uuid(objectValue(body, "canary response").sandboxEmailId);
}

export async function pollSandboxCanary(
  hosted: HostedConfig,
  workspace: string,
  token: string,
  canaryId: string,
  dependencies: HostedTestDependencies,
): Promise<ProviderTerminalResult> {
  const url = `${canaryCollection(hosted, workspace)}/${encodeURIComponent(canaryId)}?environment=sandbox`;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const body = objectValue(
      await requestJson(dependencies.fetch, url, token),
      "canary readback",
    );
    if (body.status === "terminal") return terminalResult(body);
    if (body.status !== "processing") throw invalidReceipt();
    const delay = positiveInteger(body.pollAfterMilliseconds);
    await dependencies.sleep(Math.min(delay, 2_000));
  }
  throw new HostedTestBlockedError("provider_readback_timeout");
}

async function requestJson(
  fetcher: HostedTestDependencies["fetch"],
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HostedTestBlockedError("core_api_unavailable");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new HostedTestBlockedError(httpReason(response.status, body));
  return body;
}

function terminalResult(body: Record<string, unknown>): ProviderTerminalResult {
  const provider = objectValue(body.provider, "provider");
  const billing = objectValue(body.billing, "billing");
  const accepted = count(provider.acceptedCount);
  const refused = count(provider.refusedCount);
  const unknown = count(provider.unknownCount);
  if (accepted + refused + unknown !== 1) throw invalidReceipt();
  const quantity = count(billing.quantity);
  if (quantity !== accepted) throw invalidReceipt();
  const providerSubmission =
    accepted === 1 ? "accepted" : refused === 1 ? "refused" : "unknown";
  const messageId = nullableText(provider.messageId);
  if (providerSubmission === "accepted" && !messageId) throw invalidReceipt();
  return {
    providerSubmission,
    providerMessageId: messageId,
    providerErrorCode: nullableText(provider.errorCode),
    acceptedEmailUsageQuantity: quantity,
  };
}

function draftCollection(hosted: HostedConfig, workspace: string): string {
  return `${hosted.coreApiBaseUrl}/v1/workspaces/${encodeURIComponent(workspace)}/broadcast-drafts?environment=sandbox`;
}

function canaryCollection(hosted: HostedConfig, workspace: string): string {
  return `${hosted.coreApiBaseUrl}/v1/workspaces/${encodeURIComponent(workspace)}/email-sandbox/canaries`;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HostedTestBlockedError(`${label.replaceAll(" ", "_")}_invalid`);
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  )
    throw invalidReceipt();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalidReceipt();
  return Number(value);
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalidReceipt();
  return Number(value);
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw invalidReceipt();
  return value;
}

function httpReason(status: number, body: unknown): string {
  const error =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).error
      : null;
  return typeof error === "string" && /^[a-z0-9_]{1,100}$/.test(error)
    ? error
    : `core_request_failed_${status}`;
}

function invalidReceipt(): HostedTestBlockedError {
  return new HostedTestBlockedError("core_receipt_invalid");
}
