import * as client from "openid-client";
import {
  assertAuthorizationActive,
  authorizeGrantWithBrowser,
  type BrowserAuthorizationDependencies,
  type BrowserAuthorizationOptions,
  type MemoryAuthorizationGrant,
  type PreparedBrowserAuthorization,
} from "./authorization-session.js";
import { openBrowser } from "./browser.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { listenForOAuthCallback } from "./loopback-callback.js";

export type {
  BrowserAuthorizationDependencies,
  BrowserAuthorizationOptions,
  BrowserAuthorizationTokenResponse,
  PreparedBrowserAuthorization,
} from "./authorization-session.js";

export interface BrowserAuthorizationSession {
  authorize(hosted: HostedConfig, signal?: AbortSignal): Promise<string>;
  refresh(hosted: HostedConfig, signal?: AbortSignal): Promise<string>;
}

const REFRESH_LEAD_MILLISECONDS = 30_000;

export async function authorizeWithBrowser(
  hosted: HostedConfig,
  options: BrowserAuthorizationOptions = {},
  dependencies: BrowserAuthorizationDependencies = productionDependencies,
): Promise<string> {
  return (
    await authorizeGrantWithBrowser(
      hosted,
      options,
      dependencies,
      dependencies.now ?? Date.now,
      (candidate) => {
        dependencies.commitGrant?.();
        return candidate;
      },
    )
  ).accessToken;
}

export function createBrowserAuthorizationSession(
  dependencies: BrowserAuthorizationDependencies = productionDependencies,
): BrowserAuthorizationSession {
  const now = dependencies.now ?? Date.now;
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
    assertAuthorizationActive(signal);
    bindAuthority(hosted);
    if (!grant) {
      throw new HostedTestBlockedError("authorization_refresh_unavailable");
    }
    if (refreshFailure) throw new HostedTestBlockedError(refreshFailure);
    if (!refreshing) {
      refreshing = grant
        .refresh()
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
    assertAuthorizationActive(signal);
    return current.accessToken;
  };

  return {
    authorize: async (hosted, signal) => {
      assertAuthorizationActive(signal);
      bindAuthority(hosted);
      if (grant) {
        if (
          grant.expiresAt !== null &&
          now() + REFRESH_LEAD_MILLISECONDS >= grant.expiresAt
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
          now,
          (candidate) => {
            dependencies.commitGrant?.();
            grant = candidate;
            return candidate;
          },
        ).finally(() => {
          authorizing = null;
        });
      }
      const current = await authorizing;
      assertAuthorizationActive(signal);
      return current.accessToken;
    },
    refresh,
  };
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
