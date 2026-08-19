import * as client from "openid-client";
import { openBrowser } from "./browser.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { listenForOAuthCallback } from "./loopback-callback.js";

export interface PreparedBrowserAuthorization {
  readonly authorizationUrl: URL;
  readonly state: string;
  exchange(callback: URL): Promise<string | undefined>;
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

export async function authorizeWithBrowser(
  hosted: HostedConfig,
  options: BrowserAuthorizationOptions = {},
  dependencies: BrowserAuthorizationDependencies = productionDependencies,
): Promise<string> {
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
    const accessToken = await prepared.exchange(callback);
    if (!accessToken)
      throw new HostedTestBlockedError("authorization_token_missing");
    return accessToken;
  } catch (error) {
    if (error instanceof HostedTestBlockedError) throw error;
    throw new HostedTestBlockedError("authorization_failed");
  } finally {
    listener?.close();
  }
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
    exchange: async (callback) =>
      (
        await client.authorizationCodeGrant(configuration, callback, {
          pkceCodeVerifier: verifier,
          expectedState: state,
        })
      ).access_token,
  };
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new HostedTestBlockedError("authorization_cancelled");
  }
}
