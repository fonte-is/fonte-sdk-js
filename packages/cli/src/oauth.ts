import * as client from "openid-client";
import { openBrowser } from "./browser.js";
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
}

export interface BrowserAuthorizationDependencies {
  prepare(hosted: HostedConfig): Promise<PreparedBrowserAuthorization>;
  openBrowser(url: URL): Promise<boolean>;
  listenForOAuthCallback(
    expectedState: string,
    options: { readonly signal?: AbortSignal },
  ): ReturnType<typeof listenForOAuthCallback>;
}

export interface BrowserAuthorizationOptions {
  readonly signal?: AbortSignal;
}

export interface BrowserAuthorizationSession {
  authorize(hosted: HostedConfig, signal?: AbortSignal): Promise<string>;
  refresh(hosted: HostedConfig, signal?: AbortSignal): Promise<string>;
}

interface MemoryAuthorizationGrant {
  readonly accessToken: string;
  readonly expiresAt: number | null;
  refresh(): Promise<MemoryAuthorizationGrant>;
}

const REFRESH_LEAD_MILLISECONDS = 30_000;

export async function authorizeWithBrowser(
  hosted: HostedConfig,
  options: BrowserAuthorizationOptions = {},
  dependencies: BrowserAuthorizationDependencies = productionDependencies,
): Promise<string> {
  return (
    await authorizeGrantWithBrowser(hosted, options, dependencies)
  ).accessToken;
}

export function createBrowserAuthorizationSession(
  dependencies: BrowserAuthorizationDependencies = productionDependencies,
): BrowserAuthorizationSession {
  let authority: string | null = null;
  let grant: MemoryAuthorizationGrant | null = null;
  let authorizing: Promise<MemoryAuthorizationGrant> | null = null;
  let refreshing: Promise<MemoryAuthorizationGrant> | null = null;
  let refreshFailure: string | null = null;

  const bindAuthority = (hosted: HostedConfig): void => {
    const next = JSON.stringify(hosted);
    if (authority !== null && authority !== next) {
      throw new HostedTestBlockedError("operation_authority_expansion");
    }
    authority = next;
  };

  const refresh = async (
    hosted: HostedConfig,
    signal?: AbortSignal,
  ): Promise<string> => {
    assertActive(signal);
    bindAuthority(hosted);
    if (!grant) {
      throw new HostedTestBlockedError("authorization_refresh_unavailable");
    }
    if (refreshFailure) throw new HostedTestBlockedError(refreshFailure);
    if (!refreshing) {
      refreshing = grant.refresh()
        .then((next) => {
          grant = next;
          refreshFailure = null;
          return next;
        })
        .catch((error: unknown) => {
          const blocked = refreshBlockedError(error);
          refreshFailure = blocked.reason;
          throw blocked;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    const current = await refreshing;
    assertActive(signal);
    return current.accessToken;
  };

  return {
    authorize: async (hosted, signal) => {
      assertActive(signal);
      bindAuthority(hosted);
      if (grant) {
        if (
          grant.expiresAt !== null &&
          Date.now() + REFRESH_LEAD_MILLISECONDS >= grant.expiresAt
        ) {
          return refresh(hosted, signal);
        }
        return grant.accessToken;
      }
      if (!authorizing) {
        authorizing = authorizeGrantWithBrowser(
          hosted,
          { signal },
          dependencies,
        ).then((initial) => {
          grant = initial;
          return initial;
        }).finally(() => {
          authorizing = null;
        });
      }
      const current = await authorizing;
      assertActive(signal);
      return current.accessToken;
    },
    refresh,
  };
}

async function authorizeGrantWithBrowser(
  hosted: HostedConfig,
  options: BrowserAuthorizationOptions,
  dependencies: BrowserAuthorizationDependencies,
): Promise<MemoryAuthorizationGrant> {
  assertActive(options.signal);
  let listener: Awaited<ReturnType<typeof listenForOAuthCallback>> | undefined;
  try {
    const prepared = await dependencies.prepare(hosted);
    assertActive(options.signal);
    listener = await dependencies.listenForOAuthCallback(prepared.state, {
      signal: options.signal,
    });
    if (!(await dependencies.openBrowser(prepared.authorizationUrl)))
      throw new HostedTestBlockedError("browser_open_failed");
    const callback = await listener.callback;
    assertActive(options.signal);
    return grant(
      await prepared.exchange(callback),
      prepared.refresh,
      null,
    );
  } catch (error) {
    if (error instanceof HostedTestBlockedError) throw error;
    throw new HostedTestBlockedError("authorization_failed");
  } finally {
    listener?.close();
  }
}

function grant(
  value: string | BrowserAuthorizationTokenResponse | undefined,
  refresh: PreparedBrowserAuthorization["refresh"],
  retainedRefreshToken: string | null,
): MemoryAuthorizationGrant {
  const response = tokenResponse(value);
  const refreshToken = response.refreshToken ?? retainedRefreshToken;
  const expiresAt = response.expiresInSeconds === undefined
    ? null
    : Date.now() + response.expiresInSeconds * 1_000;
  return {
    accessToken: response.accessToken,
    expiresAt,
    refresh: async () => {
      if (!refreshToken || !refresh) {
        throw new HostedTestBlockedError("authorization_refresh_unavailable");
      }
      return grant(
        await refresh(refreshToken),
        refresh,
        refreshToken,
      );
    },
  };
}

function tokenResponse(
  value: string | BrowserAuthorizationTokenResponse | undefined,
): BrowserAuthorizationTokenResponse {
  const response = typeof value === "string" ? { accessToken: value } : value;
  if (
    !response ||
    !response.accessToken.trim() ||
    (response.refreshToken !== undefined && !response.refreshToken.trim()) ||
    (response.expiresInSeconds !== undefined &&
      (!Number.isFinite(response.expiresInSeconds) ||
        response.expiresInSeconds <= 0))
  ) {
    throw new HostedTestBlockedError("authorization_token_missing");
  }
  return response;
}

function refreshBlockedError(error: unknown): HostedTestBlockedError {
  if (
    error instanceof HostedTestBlockedError &&
    error.reason === "authorization_refresh_unavailable"
  ) {
    return error;
  }
  return new HostedTestBlockedError("authorization_refresh_failed");
}

const productionDependencies: BrowserAuthorizationDependencies = {
  prepare: prepareOpenIdAuthorization,
  openBrowser,
  listenForOAuthCallback,
};

async function prepareOpenIdAuthorization(
  hosted: HostedConfig,
): Promise<PreparedBrowserAuthorization> {
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const configuration = await client.discovery(
    new URL(hosted.authorizationServer),
    hosted.clientId,
    { token_endpoint_auth_method: "none" },
    client.None(),
    { algorithm: "oauth2", timeout: 10 },
  );
  return {
    state,
    authorizationUrl: client.buildAuthorizationUrl(configuration, {
      redirect_uri: hosted.redirectUri,
      scope: hosted.scopes.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }),
    exchange: async (callback) => {
      const response = await client.authorizationCodeGrant(
        configuration,
        callback,
        {
          pkceCodeVerifier: verifier,
          expectedState: state,
        },
      );
      return {
        accessToken: response.access_token,
        ...(response.refresh_token
          ? { refreshToken: response.refresh_token }
          : {}),
        ...(response.expires_in === undefined
          ? {}
          : { expiresInSeconds: response.expires_in }),
      };
    },
    refresh: async (refreshToken) => {
      const response = await client.refreshTokenGrant(
        configuration,
        refreshToken,
      );
      return {
        accessToken: response.access_token,
        ...(response.refresh_token
          ? { refreshToken: response.refresh_token }
          : {}),
        ...(response.expires_in === undefined
          ? {}
          : { expiresInSeconds: response.expires_in }),
      };
    },
  };
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new HostedTestBlockedError("authorization_cancelled");
  }
}
