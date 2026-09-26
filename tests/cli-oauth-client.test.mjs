import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  prepareOpenIdAuthorization,
  refreshOpenIdAuthorization,
  renewOpenIdAuthorization,
} from "../packages/cli/dist/oauth-client.js";

const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const metadata = {
  issuer: hosted.authorizationServer,
  authorization_endpoint: `${hosted.authorizationServer}/authorize`,
  token_endpoint: `${hosted.authorizationServer}/token`,
  userinfo_endpoint: `${hosted.authorizationServer}/userinfo`,
};
const tokens = {
  access_token: "synthetic-access-token",
  refresh_token: "synthetic-refresh-token",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "email",
};

function provider(t, overrides = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, new URL(hosted.authorizationServer).origin);
    assert.equal(options.redirect, "error");
    const kind = url.pathname.includes(".well-known/")
      ? "discovery"
      : url.pathname.split("/").at(-1);
    calls.push({ kind, url, options });
    const custom = await overrides.respond?.({ kind, url, options });
    if (custom !== undefined) return custom;
    if (overrides.redirect === kind) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.example.test/collect" },
      });
    }
    const body =
      kind === "discovery"
        ? { ...metadata, ...overrides.metadata }
        : kind === "token"
          ? { ...tokens, ...overrides.tokens }
          : { sub: "synthetic-subject", ...overrides.user };
    return Response.json(body);
  });
  return calls;
}

function renew(overrides = {}) {
  return renewOpenIdAuthorization({
    hosted,
    refreshToken: "previous-refresh-token",
    expectedSubject: "synthetic-subject",
    beforeExchange: async () => {},
    ...overrides,
  });
}

function assertFailure(outcome, expected) {
  assert.deepEqual(outcome, expected);
  assert.deepEqual(Object.keys(outcome).sort(), [
    "exchangeSubmitted",
    "reason",
    "tag",
  ]);
}

function callback(prepared) {
  const url = new URL(hosted.redirectUri);
  url.searchParams.set("code", "synthetic-code");
  url.searchParams.set("state", prepared.state);
  return url;
}

test("persistent code grant binds PKCE, client, exact scopes and authenticated UserInfo", async (t) => {
  const calls = provider(t);
  const prepared = await prepareOpenIdAuthorization(hosted, {
    persistent: true,
  });
  const parameters = prepared.authorizationUrl.searchParams;
  assert.equal(parameters.get("scope"), "email");
  assert.equal(parameters.get("client_id"), hosted.clientId);
  assert.equal(parameters.get("redirect_uri"), hosted.redirectUri);
  assert.equal(parameters.get("code_challenge_method"), "S256");
  assert.equal(parameters.has("prompt"), false);
  const grant = await prepared.exchange(callback(prepared));
  assert.equal(grant.accessToken, tokens.access_token);
  assert.equal(grant.refreshToken, tokens.refresh_token);
  assert.equal(grant.subject, "synthetic-subject");
  assert.deepEqual(grant.scopes, ["email"]);
  assert.ok(grant.expiresInSeconds > 3590 && grant.expiresInSeconds <= 3600);
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery", "token", "userinfo"],
  );
  const request = new URLSearchParams(calls[1].options.body);
  assert.equal(request.get("grant_type"), "authorization_code");
  assert.equal(request.get("client_id"), hosted.clientId);
  assert.equal(request.get("code"), "synthetic-code");
  assert.equal(
    createHash("sha256")
      .update(request.get("code_verifier"))
      .digest("base64url"),
    parameters.get("code_challenge"),
  );
  assert.equal(
    new Headers(calls[2].options.headers).get("authorization"),
    `Bearer ${tokens.access_token}`,
  );
  assert.equal(calls[2].url.search, "");
});

test("legacy default accepts an access-only grant without UserInfo or persistence", async (t) => {
  const calls = provider(t, {
    tokens: { refresh_token: undefined, expires_in: undefined },
  });
  const prepared = await prepareOpenIdAuthorization(hosted);
  assert.deepEqual(await prepared.exchange(callback(prepared)), {
    accessToken: tokens.access_token,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery", "token"],
  );
});

test("account switching requests selection without widening scope", async (t) => {
  provider(t);
  const prepared = await prepareOpenIdAuthorization(hosted, {
    persistent: true,
    switchAccount: true,
  });
  assert.equal(
    prepared.authorizationUrl.searchParams.get("prompt"),
    "select_account",
  );
  assert.equal(prepared.authorizationUrl.searchParams.get("scope"), "email");
});

test("state mismatch never submits the code or fetches UserInfo", async (t) => {
  const calls = provider(t);
  const prepared = await prepareOpenIdAuthorization(hosted, {
    persistent: true,
  });
  const mismatched = callback(prepared);
  mismatched.searchParams.set("state", "wrong-state");
  await assert.rejects(prepared.exchange(mismatched), /authorization_failed/);
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

for (const [name, response] of Object.entries({
  missingRefresh: { refresh_token: undefined },
  emptyRefresh: { refresh_token: "" },
  missingExpiry: { expires_in: undefined },
  zeroExpiry: { expires_in: 0 },
  negativeExpiry: { expires_in: -1 },
  overflowExpiry: { expires_in: 1e308 },
  widenedScopes: { scope: "email openid" },
  changedScopes: { scope: "profile" },
  emptyScopes: { scope: "" },
  duplicateScopes: { scope: "email email" },
})) {
  test(`persistent grant rejects ${name} before identity lookup`, async (t) => {
    const calls = provider(t, { tokens: response });
    const prepared = await prepareOpenIdAuthorization(hosted, {
      persistent: true,
    });
    await assert.rejects(
      prepared.exchange(callback(prepared)),
      /authorization_failed/,
    );
    assert.equal(
      calls.some(({ kind }) => kind === "userinfo"),
      false,
    );
  });
}

test("omitted granted scope retains the exact requested scope", async (t) => {
  provider(t, { tokens: { scope: undefined } });
  const prepared = await prepareOpenIdAuthorization(hosted, {
    persistent: true,
  });
  const grant = await prepared.exchange(callback(prepared));
  assert.deepEqual(grant.scopes, ["email"]);
});

for (const rotated of [true, false]) {
  test(`refresh verifies saved identity and ${rotated ? "rotates" : "retains"} the refresh token`, async (t) => {
    const calls = provider(t, {
      tokens: {
        refresh_token: rotated ? "rotated-refresh-token" : undefined,
        scope: undefined,
      },
    });
    const grant = await refreshOpenIdAuthorization(
      hosted,
      "previous-refresh-token",
      "synthetic-subject",
    );
    assert.equal(
      grant.refreshToken,
      rotated ? "rotated-refresh-token" : "previous-refresh-token",
    );
    assert.equal(grant.subject, "synthetic-subject");
    assert.deepEqual(grant.scopes, ["email"]);
    const request = new URLSearchParams(calls[1].options.body);
    assert.equal(request.get("grant_type"), "refresh_token");
    assert.equal(request.get("refresh_token"), "previous-refresh-token");
    assert.equal(request.get("client_id"), hosted.clientId);
  });
}

test("refresh fails closed for a changed subject without disclosing provider content", async (t) => {
  provider(t, { user: { sub: "other-subject" } });
  await assert.rejects(
    refreshOpenIdAuthorization(
      hosted,
      "previous-refresh-token",
      "synthetic-subject",
    ),
    (error) => {
      assert.equal(error.reason, "authorization_refresh_failed");
      assert.doesNotMatch(
        JSON.stringify(error),
        /other-subject|synthetic-subject|token/,
      );
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test("prepared persistent refresh remains bound to the initial authenticated subject", async (t) => {
  const override = { user: { sub: "synthetic-subject" } };
  provider(t, override);
  const prepared = await prepareOpenIdAuthorization(hosted, {
    persistent: true,
  });
  await assert.rejects(
    prepared.refresh("previous-refresh-token"),
    /authorization_refresh_failed/,
  );
  await prepared.exchange(callback(prepared));
  override.user.sub = "other-subject";
  await assert.rejects(
    prepared.refresh("previous-refresh-token"),
    /authorization_refresh_failed/,
  );
});

for (const [name, value] of Object.entries({
  noUserInfo: { userinfo_endpoint: undefined },
  unsafeToken: { token_endpoint: "http://identity.example.test/token" },
  foreignToken: { token_endpoint: "https://untrusted.example.test/token" },
  foreignUserInfo: {
    userinfo_endpoint: "https://untrusted.example.test/userinfo",
  },
  foreignAuthorization: {
    authorization_endpoint: "https://untrusted.example.test/authorize",
  },
  credentials: {
    userinfo_endpoint: "https://user:secret@identity.example.test/userinfo",
  },
  fragment: { token_endpoint: "https://identity.example.test/token#fragment" },
  wrongIssuer: { issuer: "https://identity.example.test/other" },
})) {
  test(`discovery rejects ${name} before sending credentials`, async (t) => {
    const calls = provider(t, { metadata: value });
    await assert.rejects(
      prepareOpenIdAuthorization(hosted, { persistent: true }),
      /authorization_failed/,
    );
    assert.deepEqual(
      calls.map(({ kind }) => kind),
      ["discovery"],
    );
  });
}

for (const endpoint of ["discovery", "token", "userinfo"]) {
  test(`${endpoint} redirects are rejected without following their destination`, async (t) => {
    const calls = provider(t, { redirect: endpoint });
    await assert.rejects(async () => {
      const prepared = await prepareOpenIdAuthorization(hosted, {
        persistent: true,
      });
      await prepared.exchange(callback(prepared));
    }, /authorization_failed/);
    assert.equal(calls.at(-1).kind, endpoint);
  });
}

test("initial grant requires an authenticated UserInfo subject", async (t) => {
  provider(t, { user: { sub: undefined } });
  const prepared = await prepareOpenIdAuthorization(hosted, {
    persistent: true,
  });
  await assert.rejects(
    prepared.exchange(callback(prepared)),
    /authorization_failed/,
  );
});

test("typed renewal marks before one exchange and returns receipt-time absolute expiry", async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const events = [];
  const calls = provider(t, {
    tokens: { refresh_token: "rotated-refresh-token", scope: undefined },
    respond: async ({ kind }) => {
      if (kind === "token") events.push("token");
      if (kind === "userinfo") now += 5_000;
    },
  });
  const outcome = await renew({
    beforeExchange: async () => events.push("marker"),
  });
  assert.deepEqual(events, ["marker", "token"]);
  assert.deepEqual(outcome, {
    tag: "success",
    exchangeSubmitted: true,
    accessToken: tokens.access_token,
    refreshToken: "rotated-refresh-token",
    subject: "synthetic-subject",
    scopes: ["email"],
    expiresAt: 4_600_000,
  });
  assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
});

test("typed renewal retains the prior refresh token only after a valid success", async (t) => {
  provider(t, { tokens: { refresh_token: undefined, scope: undefined } });
  const outcome = await renew();
  assert.equal(outcome.tag, "success");
  assert.equal(outcome.refreshToken, "previous-refresh-token");
  assert.equal(outcome.subject, "synthetic-subject");
  assert.deepEqual(outcome.scopes, ["email"]);
});

test("discovery transport failure is retryable without token submission", async (t) => {
  const calls = provider(t, {
    respond: async ({ kind }) => {
      if (kind === "discovery") throw new TypeError("synthetic outage");
    },
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "retryable_before_exchange",
    reason: "provider_unavailable",
    exchangeSubmitted: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

test("marker failure is retryable and prevents token submission", async (t) => {
  const calls = provider(t);
  const outcome = await renew({
    beforeExchange: async () => {
      throw new Error("synthetic marker failure");
    },
  });
  assertFailure(outcome, {
    tag: "retryable_before_exchange",
    reason: "provider_unavailable",
    exchangeSubmitted: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

test("cancellation before exchange never submits a refresh token", async (t) => {
  const controller = new AbortController();
  const calls = provider(t);
  const outcome = await renew({
    signal: controller.signal,
    beforeExchange: async () => controller.abort(),
  });
  assertFailure(outcome, {
    tag: "cancelled_before_exchange",
    reason: "cancelled",
    exchangeSubmitted: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

test("cancellation during discovery is classified before exchange", async (t) => {
  const controller = new AbortController();
  const calls = provider(t, {
    respond: async ({ kind }) => {
      if (kind !== "discovery") return undefined;
      controller.abort();
      throw controller.signal.reason;
    },
  });
  const outcome = await renew({ signal: controller.signal });
  assertFailure(outcome, {
    tag: "cancelled_before_exchange",
    reason: "cancelled",
    exchangeSubmitted: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

test("untrusted discovery metadata is a configuration rejection", async (t) => {
  const calls = provider(t, {
    metadata: { token_endpoint: "https://untrusted.example.test/token" },
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "rejected_configuration",
    reason: "configuration_rejected",
    exchangeSubmitted: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

test("invalid client binding is rejected without discovery or exchange", async (t) => {
  const calls = provider(t);
  const outcome = await renew({ hosted: { ...hosted, clientId: "" } });
  assertFailure(outcome, {
    tag: "rejected_configuration",
    reason: "configuration_rejected",
    exchangeSubmitted: false,
  });
  assert.deepEqual(calls, []);
});

test("a discovery redirect is a configuration rejection rather than a retry origin", async (t) => {
  const calls = provider(t, { redirect: "discovery" });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "rejected_configuration",
    reason: "configuration_rejected",
    exchangeSubmitted: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery"],
  );
});

test("typed invalid_grant is revoked without inspecting native messages", async (t) => {
  const calls = provider(t, {
    respond: async ({ kind }) =>
      kind === "token"
        ? Response.json(
            {
              error: "invalid_grant",
              error_description: "contains synthetic-refresh-token",
            },
            { status: 400 },
          )
        : undefined,
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "rejected_invalid_grant",
    reason: "invalid_grant",
    exchangeSubmitted: true,
  });
  assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
  assert.doesNotMatch(JSON.stringify(outcome), /synthetic-refresh-token/);
});

test("an untyped invalid_grant message after dispatch remains uncertain", async (t) => {
  const calls = provider(t, {
    respond: async ({ kind }) => {
      if (kind === "token") throw new Error("invalid_grant");
    },
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "exchange_uncertain",
    reason: "exchange_uncertain",
    exchangeSubmitted: true,
  });
  assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
});

test("invalid_grant on a nonstandard status remains uncertain", async (t) => {
  const calls = provider(t, {
    respond: async ({ kind }) =>
      kind === "token"
        ? Response.json({ error: "invalid_grant" }, { status: 429 })
        : undefined,
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "exchange_uncertain",
    reason: "exchange_uncertain",
    exchangeSubmitted: true,
  });
  assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
});

for (const [name, tokenResponse] of Object.entries({
  rateLimited: () =>
    Response.json({ error: "temporarily_unavailable" }, { status: 429 }),
  serverError: () => Response.json({ error: "server_error" }, { status: 503 }),
  malformedSuccess: () =>
    new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  lostBody: () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("synthetic response loss"));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
})) {
  test(`${name} after token dispatch is uncertain and is not retried`, async (t) => {
    const calls = provider(t, {
      respond: async ({ kind }) =>
        kind === "token" ? tokenResponse() : undefined,
    });
    const outcome = await renew();
    assert.equal(outcome.tag, "exchange_uncertain");
    assert.equal(outcome.exchangeSubmitted, true);
    assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
  });
}

test("abort after token dispatch is uncertain rather than retryable", async (t) => {
  const controller = new AbortController();
  const calls = provider(t, {
    respond: async ({ kind }) => {
      if (kind !== "token") return undefined;
      controller.abort();
      throw controller.signal.reason;
    },
  });
  const outcome = await renew({ signal: controller.signal });
  assertFailure(outcome, {
    tag: "exchange_uncertain",
    reason: "exchange_uncertain",
    exchangeSubmitted: true,
  });
  assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
});

for (const [name, overrides, reason] of [
  ["subject", { user: { sub: "other-subject" } }, "subject_mismatch"],
  ["scope", { tokens: { scope: "profile" } }, "scope_mismatch"],
]) {
  test(`${name} mismatch after issuance cannot commit`, async (t) => {
    const calls = provider(t, overrides);
    const outcome = await renew();
    assertFailure(outcome, {
      tag: "identity_mismatch",
      reason,
      exchangeSubmitted: true,
    });
    assert.equal(calls.filter(({ kind }) => kind === "token").length, 1);
  });
}

test("UserInfo failure after rotation is uncertain and exposes no reusable token", async (t) => {
  const calls = provider(t, {
    tokens: { refresh_token: "rotated-refresh-token" },
    respond: async ({ kind }) => {
      if (kind === "userinfo") throw new TypeError("synthetic userinfo loss");
    },
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "exchange_uncertain",
    reason: "exchange_uncertain",
    exchangeSubmitted: true,
  });
  assert.doesNotMatch(
    JSON.stringify(outcome),
    /previous-refresh-token|rotated-refresh-token|synthetic-access-token/,
  );
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["discovery", "token", "userinfo"],
  );
});

test("expiry exhausted during UserInfo validation is an invalid uncertain response", async (t) => {
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  provider(t, {
    tokens: { expires_in: 1 },
    respond: async ({ kind }) => {
      if (kind === "userinfo") now += 1_001;
    },
  });
  const outcome = await renew();
  assertFailure(outcome, {
    tag: "exchange_uncertain",
    reason: "response_invalid",
    exchangeSubmitted: true,
  });
});

test("credential-bearing callback errors are sanitized at the renewal boundary", async (t) => {
  provider(t);
  const secret = "sensitive-credential-value";
  const outcome = await renew({
    refreshToken: secret,
    beforeExchange: async () => {
      throw new Error(`failed to store ${secret}`);
    },
  });
  assertFailure(outcome, {
    tag: "retryable_before_exchange",
    reason: "provider_unavailable",
    exchangeSubmitted: false,
  });
  assert.doesNotMatch(JSON.stringify(outcome), new RegExp(secret));
});
