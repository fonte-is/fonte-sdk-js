import type {
  BrowserAuthorizationDependencies,
  BrowserAuthorizationTokenResponse,
} from "./authorization-session.js";
import {
  CLIENT_SESSION_SCHEMA,
  type ClientAuthBinding,
  type ClientSessionRecord,
} from "./client-auth-types.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import type { SecureLoginStore } from "./secure-login-store.js";

/** Compatibility dependencies retained until the composition leaf switches. */
export interface PersistentLoginDependencies {
  store: SecureLoginStore;
  withLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  browser: BrowserAuthorizationDependencies;
  prepareLogin(
    hosted: HostedConfig,
    switchAccount: boolean,
  ): ReturnType<BrowserAuthorizationDependencies["prepare"]>;
  refreshGrant(
    hosted: HostedConfig,
    refreshToken: string,
    subject: string,
  ): Promise<BrowserAuthorizationTokenResponse>;
  now?(): number;
  randomUUID?(): string;
}

export function clientAuthBinding(hosted: HostedConfig): ClientAuthBinding {
  return {
    issuer: hosted.authorizationServer,
    clientId: hosted.clientId,
    scopes: [...hosted.scopes].sort(),
    coreApiTarget: hosted.coreApiBaseUrl,
    redirectUri: hosted.redirectUri,
  };
}

/** Stable compatibility key; no credential is included. */
export function loginAuthority(hosted: HostedConfig): string {
  return JSON.stringify(clientAuthBinding(hosted));
}

export function parseSessionRecord(value: unknown): ClientSessionRecord {
  try {
    if (typeof value === "string") {
      if (value.length > 32_768) return invalid();
      value = JSON.parse(value);
    }
    if (!object(value)) return invalid();
    requireKeys(value, keysForState(value.state));
    if (
      value.schema !== CLIENT_SESSION_SCHEMA ||
      !safeUuid(value.epoch) ||
      !safeGeneration(value.generation)
    )
      return invalid();
    switch (value.state) {
      case "signed_out":
        return value as unknown as ClientSessionRecord;
      case "login_pending": {
        binding(value.binding);
        if (
          !safeUuid(value.loginId) ||
          !safeTimestamp(value.createdAt) ||
          !safeTimestamp(value.expiresAt) ||
          value.expiresAt !== value.createdAt + 300_000
        )
          return invalid();
        return value as unknown as ClientSessionRecord;
      }
      case "ready":
      case "refresh_pending":
      case "refresh_uncertain":
        credential(value, true);
        return value as unknown as ClientSessionRecord;
      case "revoked":
        credential(value, false);
        if (value.refreshToken !== undefined && !safeSecret(value.refreshToken))
          return invalid();
        return value as unknown as ClientSessionRecord;
      default:
        return invalid();
    }
  } catch {
    return invalid();
  }
}

export function sameBinding(
  left: ClientAuthBinding,
  right: ClientAuthBinding,
): boolean {
  const leftScopes = [...left.scopes].sort();
  const rightScopes = [...right.scopes].sort();
  return (
    left.issuer === right.issuer &&
    left.clientId === right.clientId &&
    left.coreApiTarget === right.coreApiTarget &&
    left.redirectUri === right.redirectUri &&
    leftScopes.length === rightScopes.length &&
    leftScopes.every((scope, index) => scope === rightScopes[index])
  );
}

export function nextGeneration(record: ClientSessionRecord | null): number {
  if (record === null) return 0;
  if (!Number.isSafeInteger(record.generation + 1)) return invalid();
  return record.generation + 1;
}

export function blocked(reason: string): HostedTestBlockedError {
  return new HostedTestBlockedError(reason);
}

function credential(value: Record<string, unknown>, requireRefresh: boolean) {
  binding(value.binding);
  if (
    !safeUuid(value.loginId) ||
    !safeText(value.subject) ||
    (requireRefresh && !safeSecret(value.refreshToken))
  )
    return invalid();
}

function binding(value: unknown): asserts value is ClientAuthBinding {
  if (!object(value)) return invalid();
  requireKeys(value, [
    "clientId",
    "coreApiTarget",
    "issuer",
    "redirectUri",
    "scopes",
  ]);
  const scopes = value.scopes;
  if (
    !safeText(value.issuer) ||
    !safeText(value.clientId) ||
    !safeText(value.coreApiTarget) ||
    !safeText(value.redirectUri) ||
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.some((scope) => !safeText(scope)) ||
    new Set(scopes).size !== scopes.length ||
    scopes.some(
      (scope, index) => index > 0 && String(scopes[index - 1]) >= String(scope),
    )
  )
    return invalid();
}

function keysForState(state: unknown): readonly string[] {
  const common = ["epoch", "generation", "schema", "state"];
  if (state === "signed_out") return common;
  if (state === "login_pending")
    return [...common, "binding", "createdAt", "expiresAt", "loginId"];
  if (["ready", "refresh_pending", "refresh_uncertain"].includes(String(state)))
    return [...common, "binding", "loginId", "refreshToken", "subject"];
  if (state === "revoked")
    return [...common, "binding", "loginId", "subject", "refreshToken?"];
  return invalid();
}

function requireKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const optional = new Set(
    expected.filter((key) => key.endsWith("?")).map((key) => key.slice(0, -1)),
  );
  const required = expected.filter((key) => !key.endsWith("?"));
  const actual = Object.keys(value);
  if (
    required.some((key) => !actual.includes(key)) ||
    actual.some((key) => !required.includes(key) && !optional.has(key))
  )
    return invalid();
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8_192 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function safeSecret(value: unknown): value is string {
  return safeText(value) && value.length <= 32_768;
}

function safeUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function safeGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function invalid(): never {
  throw blocked("login_invalid");
}
