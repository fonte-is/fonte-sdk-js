import { randomUUID } from "node:crypto";
import type {
  BrowserAuthorizationDependencies,
  BrowserAuthorizationTokenResponse,
  MemoryAuthorizationGrant,
} from "./authorization-session.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import type { SecureLoginStore } from "./secure-login-store.js";

export interface StoredLogin {
  version: 1;
  authority: string;
  subject: string;
  refreshToken: string;
  loginId: string;
}

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
}

export function loginAuthority(hosted: HostedConfig): string {
  return JSON.stringify([
    hosted.authorizationServer,
    hosted.clientId,
    [...hosted.scopes].sort(),
    hosted.coreApiBaseUrl,
    hosted.redirectUri,
  ]);
}

export function parseLogin(value: string): StoredLogin {
  try {
    if (value.length > 32_768) throw blocked("login_invalid");
    const row: unknown = JSON.parse(value);
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw blocked("login_invalid");
    const record = row as StoredLogin;
    if (
      Object.keys(record).sort().join(",") !==
        "authority,loginId,refreshToken,subject,version" ||
      record.version !== 1 ||
      ![
        record.authority,
        record.loginId,
        record.refreshToken,
        record.subject,
      ].every(
        (item) =>
          typeof item === "string" &&
          item.trim() &&
          !/[\u0000-\u001f]/.test(item),
      )
    )
      throw blocked("login_invalid");
    return record;
  } catch {
    throw blocked("login_invalid");
  }
}

export function candidateLogin(
  candidate: MemoryAuthorizationGrant,
  bind: () => string,
  now: () => number,
): { stored: StoredLogin; grant: BrowserAuthorizationTokenResponse } {
  if (
    !candidate.subject ||
    !candidate.refreshToken ||
    candidate.expiresAt === null
  )
    throw blocked("login_invalid");
  return {
    stored: {
      version: 1,
      authority: bind(),
      subject: candidate.subject,
      refreshToken: candidate.refreshToken,
      loginId: randomUUID(),
    },
    grant: {
      accessToken: candidate.accessToken,
      subject: candidate.subject,
      refreshToken: candidate.refreshToken,
      expiresInSeconds: (candidate.expiresAt - now()) / 1_000,
    },
  };
}

export function validateLoginGrant(
  stored: StoredLogin,
  grant: BrowserAuthorizationTokenResponse,
) {
  if (
    !grant.accessToken?.trim() ||
    grant.subject !== stored.subject ||
    !grant.refreshToken?.trim() ||
    !Number.isFinite(grant.expiresInSeconds) ||
    grant.expiresInSeconds! <= 0
  )
    throw blocked("login_invalid");
}

export function blocked(reason: string) {
  return new HostedTestBlockedError(reason);
}
