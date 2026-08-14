import * as client from "openid-client";
import { openBrowser } from "./browser.js";
import type { HostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { listenForOAuthCallback } from "./loopback-callback.js";

export async function authorizeWithBrowser(
  hosted: HostedConfig,
): Promise<string> {
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const listener = await listenForOAuthCallback(state);
  try {
    const configuration = await client.discovery(
      new URL(hosted.authorizationServer),
      hosted.clientId,
      { token_endpoint_auth_method: "none" },
      client.None(),
      { algorithm: "oauth2", timeout: 10 },
    );
    const authorizationUrl = client.buildAuthorizationUrl(configuration, {
      redirect_uri: hosted.redirectUri,
      scope: hosted.scopes.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    if (!(await openBrowser(authorizationUrl)))
      throw new HostedTestBlockedError("browser_open_failed");
    const callback = await listener.callback;
    const tokens = await client.authorizationCodeGrant(
      configuration,
      callback,
      {
        pkceCodeVerifier: verifier,
        expectedState: state,
      },
    );
    if (!tokens.access_token)
      throw new HostedTestBlockedError("authorization_token_missing");
    return tokens.access_token;
  } catch (error) {
    if (error instanceof HostedTestBlockedError) throw error;
    throw new HostedTestBlockedError("authorization_failed");
  } finally {
    listener.close();
  }
}
