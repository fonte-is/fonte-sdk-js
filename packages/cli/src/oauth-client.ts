import * as client from "openid-client";
import type {
  BrowserAuthorizationTokenResponse,
  PreparedBrowserAuthorization,
} from "./authorization-session.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";

export interface OpenIdAuthorizationOptions {
  readonly persistent?: boolean;
  readonly switchAccount?: boolean;
}

export async function prepareOpenIdAuthorization(
  hosted: HostedConfig,
  options: OpenIdAuthorizationOptions = {},
): Promise<PreparedBrowserAuthorization> {
  return protect("authorization_failed", async () => {
    const bound: HostedConfig = { ...hosted, scopes: [...hosted.scopes] };
    const persistent = options.persistent === true;
    const configuration = await discover(bound, persistent);
    const verifier = client.randomPKCECodeVerifier();
    const challenge = await client.calculatePKCECodeChallenge(verifier);
    const state = client.randomState();
    let subject: string | undefined;
    return {
      state,
      authorizationUrl: client.buildAuthorizationUrl(configuration, {
        redirect_uri: bound.redirectUri,
        scope: bound.scopes.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        ...(options.switchAccount ? { prompt: "select_account" } : {}),
      }),
      exchange: (callback) =>
        protect("authorization_failed", async () => {
          const response = await client.authorizationCodeGrant(
            configuration,
            callback,
            {
              pkceCodeVerifier: verifier,
              expectedState: state,
            },
          );
          if (!persistent) return tokenResponse(response);
          const grant = await verifiedGrant(configuration, bound, response);
          subject = grant.subject;
          return grant;
        }),
      refresh: (refreshToken) =>
        protect("authorization_refresh_failed", async () => {
          if (persistent && !subject) throw new Error("missing_subject");
          const response = await client.refreshTokenGrant(
            configuration,
            refreshToken,
          );
          return persistent
            ? verifiedGrant(
                configuration,
                bound,
                response,
                subject,
                refreshToken,
              )
            : tokenResponse(response);
        }),
    };
  });
}

export async function refreshOpenIdAuthorization(
  hosted: HostedConfig,
  refreshToken: string,
  expectedSubject: string,
): Promise<BrowserAuthorizationTokenResponse> {
  return protect("authorization_refresh_failed", async () => {
    if (!refreshToken.trim() || !expectedSubject.trim())
      throw new Error("missing_grant");
    const bound: HostedConfig = { ...hosted, scopes: [...hosted.scopes] };
    const configuration = await discover(bound, true);
    const response = await client.refreshTokenGrant(
      configuration,
      refreshToken,
    );
    return verifiedGrant(
      configuration,
      bound,
      response,
      expectedSubject,
      refreshToken,
    );
  });
}

async function discover(
  hosted: HostedConfig,
  persistent: boolean,
): Promise<client.Configuration> {
  const issuer = new URL(hosted.authorizationServer);
  assertTrustedEndpoint(issuer.href, issuer);
  const configuration = await client.discovery(
    issuer,
    hosted.clientId,
    { token_endpoint_auth_method: "none" },
    client.None(),
    {
      algorithm: "oauth2",
      timeout: 10,
      [client.customFetch]: issuerFetch(issuer),
    },
  );
  const metadata = configuration.serverMetadata();
  if (new URL(metadata.issuer).href !== issuer.href)
    throw new Error("issuer_mismatch");
  assertTrustedEndpoint(metadata.authorization_endpoint, issuer);
  assertTrustedEndpoint(metadata.token_endpoint, issuer);
  if (persistent) assertTrustedEndpoint(metadata.userinfo_endpoint, issuer);
  return configuration;
}

function assertTrustedEndpoint(value: string | undefined, issuer: URL): void {
  if (!value) throw new Error("missing_endpoint");
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.origin !== issuer.origin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new Error("untrusted_endpoint");
  }
}

function issuerFetch(issuer: URL): client.CustomFetch {
  return async (url, options) => {
    assertTrustedEndpoint(url, issuer);
    // Never forward a code, refresh token, or UserInfo bearer through redirects.
    const body =
      options.body instanceof Uint8Array
        ? new Uint8Array(options.body).buffer
        : options.body;
    const response = await fetch(url, { ...options, body, redirect: "error" });
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new Error("endpoint_redirect");
    }
    return response;
  };
}

function tokenResponse(
  response: client.TokenEndpointResponse,
): BrowserAuthorizationTokenResponse {
  return {
    accessToken: response.access_token,
    ...(response.refresh_token === undefined
      ? {}
      : { refreshToken: response.refresh_token }),
    ...(response.expires_in === undefined
      ? {}
      : { expiresInSeconds: response.expires_in }),
  };
}

async function verifiedGrant(
  configuration: client.Configuration,
  hosted: HostedConfig,
  response: client.TokenEndpointResponse,
  expectedSubject?: string,
  retainedRefreshToken?: string,
): Promise<BrowserAuthorizationTokenResponse> {
  const refreshToken = response.refresh_token ?? retainedRefreshToken;
  const expiresAt = Date.now() + (response.expires_in ?? NaN) * 1_000;
  if (
    !response.access_token.trim() ||
    !refreshToken?.trim() ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  )
    throw new Error("invalid_grant");
  // RFC 6749 sections 5.1 and 6: omitted scope retains the requested/granted scope.
  const scopes =
    response.scope === undefined
      ? [...hosted.scopes]
      : response.scope.split(" ");
  if (
    scopes.length !== hosted.scopes.length ||
    new Set(scopes).size !== scopes.length ||
    scopes.some(
      (scope) => !hosted.scopes.some((expected) => expected === scope),
    )
  ) {
    throw new Error("scope_mismatch");
  }
  // The email-only OAuth grant has no ID token. Initial identity is learned from
  // the issuer's authenticated TLS UserInfo endpoint using the PKCE grant's
  // bearer. Every refresh must match that saved subject; no JWT is decoded here.
  const user = await client.fetchUserInfo(
    configuration,
    response.access_token,
    expectedSubject ?? client.skipSubjectCheck,
  );
  if (!user.sub.trim()) throw new Error("missing_subject");
  const expiresInSeconds = (expiresAt - Date.now()) / 1_000;
  if (expiresInSeconds <= 0) throw new Error("expired_grant");
  return {
    accessToken: response.access_token,
    refreshToken,
    expiresInSeconds,
    subject: user.sub,
    scopes,
  };
}

async function protect<T>(
  reason: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    // Provider error bodies may contain credentials or identity information.
    throw new HostedTestBlockedError(reason);
  }
}
