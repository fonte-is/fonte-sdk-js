import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";

import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { listenForOAuthCallback } from "../packages/cli/dist/loopback-callback.js";
import { authorizeWithBrowser } from "../packages/cli/dist/oauth.js";

const bearer = "header.payload.signature";
const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

test("exchange, validation, commit, cancellation, and expiry never project success", async () => {
  const cases = [
    {
      name: "exchange",
      exchange: async () => {
        throw new Error("synthetic exchange failure");
      },
      expected: ["exchanging", "failed"],
      reason: "authorization_failed",
    },
    {
      name: "validation",
      exchange: async () => undefined,
      expected: ["exchanging", "validating", "failed"],
      reason: "authorization_token_missing",
    },
    {
      name: "commit",
      commitGrant: () => {
        throw new Error("synthetic commit failure");
      },
      exchange: async () => bearer,
      expected: ["exchanging", "validating", "committing_grant", "failed"],
      reason: "authorization_failed",
    },
    {
      name: "expiry",
      callback: () =>
        Promise.reject(new HostedTestBlockedError("authorization_timeout")),
      exchange: async () => assert.fail("expiry must not exchange"),
      expected: ["expired"],
      reason: "authorization_timeout",
    },
  ];

  for (const scenario of cases) {
    const phases = [];
    await assert.rejects(
      authorizeWithBrowser(
        config,
        {},
        {
          commitGrant: scenario.commitGrant,
          prepare: async () => ({
            state: `${scenario.name}-state`,
            authorizationUrl: new URL(
              "https://identity.example.test/authorize",
            ),
            exchange: scenario.exchange,
          }),
          listenForOAuthCallback: async () => ({
            callback:
              scenario.callback?.() ??
              Promise.resolve(
                new URL(
                  `http://127.0.0.1:49671/callback?code=synthetic-code&state=${scenario.name}-state`,
                ),
              ),
            boundPort: 49671,
            transition: (phase) => phases.push(phase),
            finish: (phase) => phases.push(phase),
            close: () => {},
          }),
          openBrowser: async () => true,
        },
      ),
      (error) =>
        error instanceof HostedTestBlockedError &&
        error.reason === scenario.reason,
    );
    assert.deepEqual(phases, scenario.expected);
    assert.equal(phases.includes("complete"), false);
  }

  const cancellation = new AbortController();
  const phases = [];
  await assert.rejects(
    authorizeWithBrowser(
      config,
      { signal: cancellation.signal },
      {
        prepare: async () => ({
          state: "cancel-state",
          authorizationUrl: new URL("https://identity.example.test/authorize"),
          exchange: async () => assert.fail("cancellation must not exchange"),
        }),
        listenForOAuthCallback: async () => ({
          callback: Promise.resolve(
            new URL(
              "http://127.0.0.1:49671/callback?code=synthetic-code&state=cancel-state",
            ),
          ),
          boundPort: 49671,
          transition: (phase) => phases.push(phase),
          finish: (phase) => phases.push(phase),
          close: () => {},
        }),
        openBrowser: async () => {
          cancellation.abort();
          return true;
        },
      },
    ),
    /authorization_cancelled/,
  );
  assert.deepEqual(phases, ["cancelled"]);
});

test("loopback status is opaque, read-only, one-shot, and truthful through bounded grace", async () => {
  const listener = await listenForOAuthCallback("expected-state", {
    bindPort: 0,
    finalStateGraceMs: 30,
    timeoutMs: 5_000,
  });
  try {
    const preliminary = await requestCallback(
      listener.boundPort,
      "/callback?code=attacker-code&state=wrong-state",
    );
    assert.equal(preliminary.status, 400);
    assert.match(preliminary.body, /Authorization not completed/);
    assert.equal(preliminary.headers.location, undefined);

    const accepted = await requestCallback(
      listener.boundPort,
      "/callback?code=synthetic-code&state=expected-state",
    );
    assert.equal(accepted.status, 303);
    assert.match(accepted.headers.location, /^\/status\/[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(
      accepted.headers.location,
      /synthetic-code|expected-state/,
    );
    assert.equal(accepted.headers["cache-control"], "no-store, max-age=0");
    assert.equal(accepted.headers["referrer-policy"], "no-referrer");
    assert.equal(accepted.headers["x-frame-options"], "DENY");

    const pending = await requestCallback(
      listener.boundPort,
      accepted.headers.location,
    );
    assert.equal(pending.status, 200);
    assert.match(pending.body, /Completing authorization/);
    assert.match(pending.body, /http-equiv="refresh" content="1"/);
    assert.doesNotMatch(pending.body, /synthetic-code|expected-state/);
    assert.match(
      pending.headers["content-security-policy"],
      /default-src 'none'.*frame-ancestors 'none'/,
    );
    assert.equal(pending.headers["access-control-allow-origin"], undefined);

    const attemptedMutation = await requestCallback(
      listener.boundPort,
      `${accepted.headers.location}?retry=1`,
    );
    assert.equal(attemptedMutation.status, 400);
    assert.equal(attemptedMutation.headers.location, undefined);

    const duplicate = await requestCallback(
      listener.boundPort,
      "/callback?code=synthetic-code&state=expected-state",
    );
    assert.equal(duplicate.status, 303);
    assert.equal(duplicate.headers.location, accepted.headers.location);
    const callback = await listener.callback;
    assert.equal(callback.searchParams.get("code"), "synthetic-code");
    assert.equal(callback.searchParams.get("state"), "expected-state");

    listener.transition("exchanging");
    listener.transition("validating");
    listener.transition("committing_grant");
    listener.finish("complete");

    const complete = await requestCallback(
      listener.boundPort,
      accepted.headers.location,
    );
    assert.equal(complete.status, 200);
    assert.match(complete.body, /Authorization complete/);
    assert.doesNotMatch(complete.body, /http-equiv="refresh"/);
    const secondTab = await requestCallback(
      listener.boundPort,
      accepted.headers.location,
    );
    assert.equal(secondTab.body, complete.body);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(
      requestCallback(listener.boundPort, accepted.headers.location),
    );
  } finally {
    listener.close();
  }
});

test("bound denial and post-callback cancellation project failure without resurrection", async () => {
  const denied = await listenForOAuthCallback("denied-state", {
    bindPort: 0,
    finalStateGraceMs: 100,
    timeoutMs: 5_000,
  });
  try {
    const deniedResult = assert.rejects(
      denied.callback,
      /authorization_denied/,
    );
    const response = await requestCallback(
      denied.boundPort,
      "/callback?error=access_denied&state=denied-state",
    );
    assert.equal(response.status, 303);
    await deniedResult;
    const status = await requestCallback(
      denied.boundPort,
      response.headers.location,
    );
    assert.match(status.body, /Authorization not completed/);
  } finally {
    denied.close();
  }

  const cancellation = new AbortController();
  const cancelled = await listenForOAuthCallback("cancelled-state", {
    bindPort: 0,
    finalStateGraceMs: 100,
    signal: cancellation.signal,
    timeoutMs: 5_000,
  });
  try {
    const accepted = await requestCallback(
      cancelled.boundPort,
      "/callback?code=synthetic-code&state=cancelled-state",
    );
    await cancelled.callback;
    cancellation.abort();
    const status = await requestCallback(
      cancelled.boundPort,
      accepted.headers.location,
    );
    assert.match(status.body, /Authorization not completed/);
    assert.throws(
      () => cancelled.transition("exchanging"),
      /authorization_failed/,
    );
    const duplicate = await requestCallback(
      cancelled.boundPort,
      "/callback?code=other-code&state=cancelled-state",
    );
    assert.equal(duplicate.headers.location, accepted.headers.location);
    const stillFailed = await requestCallback(
      cancelled.boundPort,
      accepted.headers.location,
    );
    assert.match(stillFailed.body, /Authorization not completed/);
  } finally {
    cancelled.close();
  }
});

function requestCallback(port, path) {
  return new Promise((resolve, reject) => {
    const pending = request(
      {
        headers: { host: "127.0.0.1:49671" },
        hostname: "127.0.0.1",
        method: "GET",
        path,
        port,
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: chunks.join(""),
            headers: response.headers,
            status: response.statusCode,
          }),
        );
      },
    );
    pending.once("error", reject);
    pending.end();
  });
}
