import {
  CoreOperatorError,
  parseCoreReceipt,
  type CoreRequester,
} from "./operator-core-request.js";
import { count, instant, object, safeText, uuid } from "./operator-json.js";
import type {
  ProviderConnectionListInput,
  ProviderConnectionListResult,
  ProviderConnectionMetadataResult,
  ProviderConnectionOAuthBeginInput,
  ProviderConnectionOAuthReadInput,
  ProviderConnectionOAuthResult,
  ProviderConnectionProvider,
} from "./operator-provider-connection-types.js";

export interface ProviderConnectionClient {
  listProviderConnections(
    input: ProviderConnectionListInput,
  ): Promise<ProviderConnectionListResult>;
  beginProviderConnectionOAuth(
    input: ProviderConnectionOAuthBeginInput,
  ): Promise<ProviderConnectionOAuthResult>;
  readProviderConnectionOAuth(
    input: ProviderConnectionOAuthReadInput,
  ): Promise<ProviderConnectionOAuthResult>;
}

export function createProviderConnectionClient(
  request: CoreRequester,
): ProviderConnectionClient {
  return {
    async listProviderConnections(input) {
      const body = object(
        await request(
          `${connectionPath(input)}?environment=${environment(input.environment)}`,
        ),
      );
      if (!Array.isArray(body.connections)) invalidReceipt("none");
      return {
        kind: "provider_connections",
        provider: input.provider,
        connections: body.connections
          .map(connection)
          .filter((value) => value.provider === input.provider),
      };
    },
    async beginProviderConnectionOAuth(input) {
      const result = parseCoreReceipt(
        oauthResult,
        await request(
          `${connectionPath(input)}/oauth/${provider(input.provider)}/attempts?environment=${environment(input.environment)}`,
          {
            idempotencyKey: uuidValue(input.attemptId),
            body: {
              attemptId: uuidValue(input.attemptId),
              connectionId: uuidValue(input.connectionId),
              displayName: displayName(input.displayName),
              operation: input.operation,
              expectedCredentialVersion: input.expectedCredentialVersion,
            },
            lostResponseEffect: "unknown",
          },
        ),
        "unknown",
      );
      return matchingAttempt(result, input, "unknown");
    },
    async readProviderConnectionOAuth(input) {
      const result = parseCoreReceipt(
        oauthResult,
        await request(
          `${connectionPath(input)}/oauth/${provider(input.provider)}/attempts/${uuidValue(input.attemptId)}?environment=${environment(input.environment)}`,
        ),
      );
      return matchingAttempt(result, input, "none");
    },
  };
}

function oauthResult(value: unknown): ProviderConnectionOAuthResult {
  const body = object(value);
  const selectedProvider = provider(body.provider);
  const operation = oauthOperation(body.operation);
  const status = oauthStatus(body.status);
  const reason = oauthReason(body.reason);
  if (selectedProvider !== "resend" || body.requestedScope !== "full_access") {
    invalidReceipt("none");
  }
  const authorizationUrl =
    body.authorizationUrl === null
      ? null
      : providerAuthorizationUrl(body.authorizationUrl);
  const result: ProviderConnectionOAuthResult = {
    kind: "provider_connection_oauth" as const,
    provider: selectedProvider,
    operation,
    attempt_id: uuid(body.attemptId),
    connection_id: uuid(body.connectionId),
    requested_scope: "full_access",
    status,
    reason,
    authorization_url: authorizationUrl,
    expires_at: instant(body.expiresAt),
    poll_after_milliseconds: pollMilliseconds(body.pollAfterMilliseconds),
    connection: body.connection === null ? null : connection(body.connection),
  };
  if (
    (status !== "waiting" && authorizationUrl !== null) ||
    (status === "ready") !== Boolean(result.connection) ||
    (status !== "ready" && result.connection !== null) ||
    (result.connection && result.connection.provider !== selectedProvider)
  ) {
    invalidReceipt("none");
  }
  return result;
}

function oauthOperation(value: unknown): "connect" | "reconnect" {
  if (value !== "connect" && value !== "reconnect") invalidReceipt("none");
  return value;
}

function oauthStatus(
  value: unknown,
): "waiting" | "ready" | "failed" | "unknown" {
  if (
    value !== "waiting" &&
    value !== "ready" &&
    value !== "failed" &&
    value !== "unknown"
  )
    invalidReceipt("none");
  return value;
}

function oauthReason(value: unknown): ProviderConnectionOAuthResult["reason"] {
  if (
    value !== "authorization_pending" &&
    value !== "connection_ready" &&
    value !== "authorization_denied" &&
    value !== "attempt_expired" &&
    value !== "completion_unknown"
  )
    invalidReceipt("none");
  return value;
}

function connection(value: unknown): ProviderConnectionMetadataResult {
  const body = object(value);
  const status = body.status;
  if (status !== "ready" && status !== "unknown") invalidReceipt("none");
  const version = count(body.credentialVersion);
  if (version < 1) invalidReceipt("none");
  return {
    provider: provider(body.provider),
    connection_id: uuid(body.connectionId),
    display_name: safeText(body.displayName, 100),
    credential_version: version,
    status,
  };
}

function matchingAttempt(
  result: ProviderConnectionOAuthResult,
  input: {
    readonly provider: ProviderConnectionProvider;
    readonly attemptId: string;
    readonly connectionId?: string;
  },
  effect: "none" | "unknown",
): ProviderConnectionOAuthResult {
  if (
    result.provider !== input.provider ||
    result.attempt_id !== input.attemptId.toLowerCase() ||
    (input.connectionId !== undefined &&
      result.connection_id !== input.connectionId.toLowerCase())
  ) {
    invalidReceipt(effect);
  }
  return result;
}

function connectionPath(input: { readonly workspace: string }): string {
  return `/v1/workspaces/${segment(input.workspace)}/connections`;
}

function provider(value: unknown): ProviderConnectionProvider {
  if (value !== "resend" && value !== "kit") invalidReceipt("none");
  return value;
}

function environment(value: string): "sandbox" | "production" {
  if (value !== "sandbox" && value !== "production") invalidRequest();
  return value;
}

function providerAuthorizationUrl(value: unknown): string {
  const raw = safeText(value, 4_000);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.resend.com" ||
    url.pathname !== "/oauth/authorize" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    invalidReceipt("none");
  }
  return url.toString();
}

function pollMilliseconds(value: unknown): number {
  const result = count(value);
  if (result < 250 || result > 5_000) invalidReceipt("none");
  return result;
}

function displayName(value: string): string {
  if (
    !value.trim() ||
    value !== value.trim() ||
    value.length > 100 ||
    /\p{C}/u.test(value)
  ) {
    invalidRequest();
  }
  return value;
}

function uuidValue(value: string): string {
  try {
    return uuid(value);
  } catch {
    return invalidRequest();
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalidRequest(): never {
  throw new CoreOperatorError(
    "provider_connection_request_invalid",
    null,
    "none",
  );
}

function invalidReceipt(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
