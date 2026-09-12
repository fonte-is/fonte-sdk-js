import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { listenForOAuthCallback } from "./loopback-callback.js";

export interface PreparedBrowserAuthorization {
  readonly authorizationUrl: URL;
  readonly state: string;
  exchange(
    callback: URL,
  ): Promise<string | BrowserAuthorizationTokenResponse | undefined>;
  refresh?(
    refreshToken: string,
  ): Promise<string | BrowserAuthorizationTokenResponse | undefined>;
}

export interface BrowserAuthorizationTokenResponse {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresInSeconds?: number;
  readonly subject?: string;
  readonly scopes?: readonly string[];
}

export interface BrowserAuthorizationDependencies {
  commitGrant?(): void | Promise<void>;
  prepare(hosted: HostedConfig): Promise<PreparedBrowserAuthorization>;
  openBrowser(url: URL): Promise<boolean>;
  listenForOAuthCallback(
    expectedState: string,
    options: { readonly signal?: AbortSignal },
  ): ReturnType<typeof listenForOAuthCallback>;
  now?(): number;
}

export interface BrowserAuthorizationOptions {
  readonly signal?: AbortSignal;
}

export interface MemoryAuthorizationGrant {
  readonly accessToken: string;
  readonly expiresAt: number | null;
  readonly refreshToken?: string;
  readonly subject?: string;
  readonly scopes?: readonly string[];
  refresh(): Promise<MemoryAuthorizationGrant>;
}

export async function authorizeGrantWithBrowser(
  hosted: HostedConfig,
  options: BrowserAuthorizationOptions,
  dependencies: BrowserAuthorizationDependencies,
  now: () => number,
  commitGrant: (
    candidate: MemoryAuthorizationGrant,
  ) => MemoryAuthorizationGrant | Promise<MemoryAuthorizationGrant>,
): Promise<MemoryAuthorizationGrant> {
  assertAuthorizationActive(options.signal);
  let listener: Awaited<ReturnType<typeof listenForOAuthCallback>> | undefined;
  try {
    const prepared = await dependencies.prepare(hosted);
    assertAuthorizationActive(options.signal);
    listener = await dependencies.listenForOAuthCallback(prepared.state, {
      signal: options.signal,
    });
    if (!(await dependencies.openBrowser(prepared.authorizationUrl))) {
      throw new HostedTestBlockedError("browser_open_failed");
    }
    const callback = await listener.callback;
    assertAuthorizationActive(options.signal);
    listener.transition("exchanging");
    const exchanged = await prepared.exchange(callback);
    assertAuthorizationActive(options.signal);
    listener.transition("validating");
    const candidate = grant(exchanged, prepared.refresh, null, now);
    listener.transition("committing_grant");
    const committed = await commitGrant(candidate);
    assertAuthorizationActive(options.signal);
    listener.finish("complete");
    return committed;
  } catch (error) {
    const blocked =
      error instanceof HostedTestBlockedError
        ? error
        : new HostedTestBlockedError("authorization_failed");
    listener?.finish(terminalPhase(blocked));
    throw blocked;
  }
}

export function assertAuthorizationActive(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) {
    throw new HostedTestBlockedError("authorization_cancelled");
  }
}

function terminalPhase(
  error: HostedTestBlockedError,
): "expired" | "cancelled" | "failed" {
  if (error.reason === "authorization_timeout") return "expired";
  if (error.reason === "authorization_cancelled") return "cancelled";
  return "failed";
}

function grant(
  value: string | BrowserAuthorizationTokenResponse | undefined,
  refresh: PreparedBrowserAuthorization["refresh"],
  retainedRefreshToken: string | null,
  now: () => number,
): MemoryAuthorizationGrant {
  const response = tokenResponse(value);
  const refreshToken = response.refreshToken ?? retainedRefreshToken;
  const expiresAt =
    response.expiresInSeconds === undefined
      ? null
      : now() + response.expiresInSeconds * 1_000;
  if (expiresAt !== null && !Number.isFinite(expiresAt)) {
    throw new HostedTestBlockedError("authorization_token_missing");
  }
  return {
    accessToken: response.accessToken,
    expiresAt,
    ...(refreshToken === null ? {} : { refreshToken }),
    ...(response.subject === undefined ? {} : { subject: response.subject }),
    ...(response.scopes === undefined ? {} : { scopes: [...response.scopes] }),
    refresh: async () => {
      if (!refreshToken || !refresh) {
        throw new HostedTestBlockedError("authorization_refresh_unavailable");
      }
      return grant(await refresh(refreshToken), refresh, refreshToken, now);
    },
  };
}

function tokenResponse(
  value: string | BrowserAuthorizationTokenResponse | undefined,
): BrowserAuthorizationTokenResponse {
  const response = typeof value === "string" ? { accessToken: value } : value;
  if (
    !response ||
    typeof response.accessToken !== "string" ||
    !response.accessToken.trim() ||
    (response.refreshToken !== undefined &&
      (typeof response.refreshToken !== "string" ||
        !response.refreshToken.trim())) ||
    (response.subject !== undefined &&
      (typeof response.subject !== "string" || !response.subject.trim())) ||
    (response.scopes !== undefined &&
      (!Array.isArray(response.scopes) ||
        response.scopes.length === 0 ||
        response.scopes.some(
          (scope) => typeof scope !== "string" || !scope.trim(),
        ))) ||
    (response.expiresInSeconds !== undefined &&
      (!Number.isFinite(response.expiresInSeconds) ||
        response.expiresInSeconds <= 0))
  ) {
    throw new HostedTestBlockedError("authorization_token_missing");
  }
  return response;
}
