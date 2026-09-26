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

export interface OpenIdRenewalOptions {
  readonly hosted: HostedConfig;
  readonly refreshToken: string;
  readonly expectedSubject: string;
  readonly signal?: AbortSignal;
  readonly beforeExchange: () => Promise<void>;
}

export type OpenIdRenewalOutcome =
  | {
      readonly tag: "success";
      readonly exchangeSubmitted: true;
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly subject: string;
      readonly scopes: readonly string[];
      readonly expiresAt: number;
    }
  | {
      readonly tag: "retryable_before_exchange";
      readonly reason: "provider_unavailable";
      readonly exchangeSubmitted: false;
    }
  | {
      readonly tag: "cancelled_before_exchange";
      readonly reason: "cancelled";
      readonly exchangeSubmitted: false;
    }
  | {
      readonly tag: "rejected_configuration";
      readonly reason: "configuration_rejected";
      readonly exchangeSubmitted: false;
    }
  | {
      readonly tag: "rejected_invalid_grant";
      readonly reason: "invalid_grant";
      readonly exchangeSubmitted: true;
    }
  | {
      readonly tag: "exchange_uncertain";
      readonly reason: "exchange_uncertain" | "response_invalid";
      readonly exchangeSubmitted: true;
    }
  | {
      readonly tag: "identity_mismatch";
      readonly reason: "subject_mismatch" | "scope_mismatch";
      readonly exchangeSubmitted: true;
    };

class OAuthConfigurationError extends TypeError {}

class GrantResponseInvalidError extends Error {}

class GrantIdentityMismatchError extends Error {
  constructor(readonly reason: "subject_mismatch" | "scope_mismatch") {
    super(reason);
  }
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

export async function renewOpenIdAuthorization({
  hosted,
  refreshToken,
  expectedSubject,
  signal,
  beforeExchange,
}: OpenIdRenewalOptions): Promise<OpenIdRenewalOutcome> {
  if (signal?.aborted)
    return failure("cancelled_before_exchange", "cancelled", false);
  if (!validRenewalInput(hosted, refreshToken, expectedSubject))
    return failure("rejected_configuration", "configuration_rejected", false);

  const bound: HostedConfig = { ...hosted, scopes: [...hosted.scopes] };
  let configuration: client.Configuration;
  try {
    configuration = await discover(bound, true, signal);
  } catch (error) {
    if (signal?.aborted)
      return failure("cancelled_before_exchange", "cancelled", false);
    if (isConfigurationError(error))
      return failure("rejected_configuration", "configuration_rejected", false);
    return failure("retryable_before_exchange", "provider_unavailable", false);
  }

  try {
    await beforeExchange();
  } catch {
    return signal?.aborted
      ? failure("cancelled_before_exchange", "cancelled", false)
      : failure("retryable_before_exchange", "provider_unavailable", false);
  }
  if (signal?.aborted)
    return failure("cancelled_before_exchange", "cancelled", false);

  let response: client.TokenEndpointResponse;
  try {
    // From this invocation onward the rotating grant may have been consumed.
    response = await client.refreshTokenGrant(configuration, refreshToken);
  } catch (error) {
    if (isInvalidGrant(error))
      return failure("rejected_invalid_grant", "invalid_grant", true);
    return failure("exchange_uncertain", "exchange_uncertain", true);
  }

  try {
    const grant = await verifiedGrantValues(
      configuration,
      bound,
      response,
      expectedSubject,
      refreshToken,
    );
    return {
      tag: "success",
      exchangeSubmitted: true,
      ...grant,
    };
  } catch (error) {
    if (error instanceof GrantIdentityMismatchError)
      return failure("identity_mismatch", error.reason, true);
    if (error instanceof GrantResponseInvalidError)
      return failure("exchange_uncertain", "response_invalid", true);
    return failure("exchange_uncertain", "exchange_uncertain", true);
  }
}

async function discover(
  hosted: HostedConfig,
  persistent: boolean,
  signal?: AbortSignal,
): Promise<client.Configuration> {
  let issuer: URL;
  try {
    issuer = new URL(hosted.authorizationServer);
  } catch {
    throw new OAuthConfigurationError();
  }
  assertTrustedEndpoint(issuer.href, issuer);
  const configuration = await client.discovery(
    issuer,
    hosted.clientId,
    { token_endpoint_auth_method: "none" },
    client.None(),
    {
      algorithm: "oauth2",
      timeout: 10,
      [client.customFetch]: issuerFetch(issuer, signal),
    },
  );
  const metadata = configuration.serverMetadata();
  let discoveredIssuer: URL;
  try {
    discoveredIssuer = new URL(metadata.issuer);
  } catch {
    throw new OAuthConfigurationError();
  }
  if (discoveredIssuer.href !== issuer.href)
    throw new OAuthConfigurationError();
  assertTrustedEndpoint(metadata.authorization_endpoint, issuer);
  assertTrustedEndpoint(metadata.token_endpoint, issuer);
  if (persistent) assertTrustedEndpoint(metadata.userinfo_endpoint, issuer);
  return configuration;
}

function assertTrustedEndpoint(value: string | undefined, issuer: URL): void {
  if (!value) throw new OAuthConfigurationError();
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new OAuthConfigurationError();
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.origin !== issuer.origin ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new OAuthConfigurationError();
  }
}

function issuerFetch(
  issuer: URL,
  callerSignal?: AbortSignal,
): client.CustomFetch {
  return async (url, options) => {
    assertTrustedEndpoint(url, issuer);
    // Never forward a code, refresh token, or UserInfo bearer through redirects.
    const body =
      options.body instanceof Uint8Array
        ? new Uint8Array(options.body).buffer
        : options.body;
    const signal = combineSignals(options.signal, callerSignal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetch(url, {
      ...options,
      body,
      redirect: "error",
      signal,
    });
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new OAuthConfigurationError();
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
  const grant = await verifiedGrantValues(
    configuration,
    hosted,
    response,
    expectedSubject,
    retainedRefreshToken,
  );
  return {
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresInSeconds: (grant.expiresAt - Date.now()) / 1_000,
    subject: grant.subject,
    scopes: [...grant.scopes],
  };
}

async function verifiedGrantValues(
  configuration: client.Configuration,
  hosted: HostedConfig,
  response: client.TokenEndpointResponse,
  expectedSubject?: string,
  retainedRefreshToken?: string,
): Promise<{
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly subject: string;
  readonly scopes: readonly string[];
}> {
  const refreshToken = response.refresh_token ?? retainedRefreshToken;
  const receivedAt = Date.now();
  const expiresAt = receivedAt + (response.expires_in ?? NaN) * 1_000;
  if (
    !response.access_token.trim() ||
    !refreshToken?.trim() ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= receivedAt
  )
    throw new GrantResponseInvalidError();
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
    throw new GrantIdentityMismatchError("scope_mismatch");
  }
  // The email-only OAuth grant has no ID token. Initial identity is learned from
  // the issuer's authenticated TLS UserInfo endpoint using the PKCE grant's
  // bearer. Every refresh must match that saved subject; no JWT is decoded here.
  const user = await client.fetchUserInfo(
    configuration,
    response.access_token,
    client.skipSubjectCheck,
  );
  if (!user.sub.trim()) throw new GrantResponseInvalidError();
  if (expectedSubject !== undefined && user.sub !== expectedSubject)
    throw new GrantIdentityMismatchError("subject_mismatch");
  if (expiresAt <= Date.now()) throw new GrantResponseInvalidError();
  return {
    accessToken: response.access_token,
    refreshToken,
    expiresAt,
    subject: user.sub,
    scopes,
  };
}

function combineSignals(
  providerSignal?: AbortSignal,
  callerSignal?: AbortSignal,
): AbortSignal | undefined {
  if (!providerSignal) return callerSignal;
  if (!callerSignal) return providerSignal;
  return AbortSignal.any([providerSignal, callerSignal]);
}

function isConfigurationError(error: unknown): boolean {
  return (
    error instanceof OAuthConfigurationError ||
    (error instanceof client.ClientError &&
      error.code === "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED")
  );
}

function isInvalidGrant(error: unknown): boolean {
  return (
    error instanceof client.ResponseBodyError &&
    error.status === 400 &&
    error.error === "invalid_grant"
  );
}

function validRenewalInput(
  hosted: HostedConfig,
  refreshToken: string,
  expectedSubject: string,
): boolean {
  return (
    !!refreshToken.trim() &&
    !!expectedSubject.trim() &&
    /^[A-Za-z0-9._~-]{8,200}$/.test(hosted.clientId) &&
    hosted.scopes.length > 0 &&
    new Set(hosted.scopes).size === hosted.scopes.length &&
    hosted.scopes.every((scope) => !!scope.trim())
  );
}

function failure<
  Tag extends Exclude<OpenIdRenewalOutcome, { readonly tag: "success" }>["tag"],
  Reason extends Extract<OpenIdRenewalOutcome, { readonly tag: Tag }>["reason"],
  Submitted extends Extract<
    OpenIdRenewalOutcome,
    { readonly tag: Tag }
  >["exchangeSubmitted"],
>(tag: Tag, reason: Reason, exchangeSubmitted: Submitted) {
  return { tag, reason, exchangeSubmitted } as Extract<
    OpenIdRenewalOutcome,
    { readonly tag: Tag }
  >;
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
