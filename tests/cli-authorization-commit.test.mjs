import assert from "node:assert/strict";
import test from "node:test";
import { authorizeGrantWithBrowser } from "../packages/cli/dist/authorization-session.js";
import {
  authorizeWithBrowser,
  createBrowserAuthorizationSession,
} from "../packages/cli/dist/oauth.js";

const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const token = {
  accessToken: "synthetic-access-token",
  refreshToken: "synthetic-refresh-token",
  expiresInSeconds: 60,
  subject: "synthetic-subject",
  scopes: ["email"],
};

function dependencies(phases, overrides = {}) {
  return {
    prepare: async () => ({
      state: "synthetic-state",
      authorizationUrl: new URL("https://identity.example.test/authorize"),
      exchange: async () => token,
      refresh: async (previous) => {
        assert.equal(previous, token.refreshToken);
        return { ...token, refreshToken: "rotated-refresh-token" };
      },
    }),
    openBrowser: async () => true,
    listenForOAuthCallback: async () => ({
      callback: Promise.resolve(
        new URL(
          `${hosted.redirectUri}?code=synthetic-code&state=synthetic-state`,
        ),
      ),
      transition: (phase) => phases.push(phase),
      finish: (phase) => phases.push(phase),
      close() {},
      boundPort: 49671,
    }),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

for (const outcome of ["success", "failure", "cancelled"]) {
  test(`callback waits for asynchronous commit ${outcome}`, async () => {
    const phases = [];
    const entered = deferred();
    const commit = deferred();
    const controller = new AbortController();
    const result = authorizeGrantWithBrowser(
      hosted,
      { signal: controller.signal },
      dependencies(phases),
      () => 1_000,
      async (candidate) => {
        assert.equal(candidate.refreshToken, token.refreshToken);
        assert.equal(candidate.subject, token.subject);
        assert.deepEqual(candidate.scopes, token.scopes);
        assert.equal(candidate.expiresAt, 61_000);
        entered.resolve();
        await commit.promise;
        if (outcome === "failure") throw new Error("synthetic storage failure");
        return candidate;
      },
    );
    const rejected =
      outcome === "success"
        ? null
        : assert.rejects(
            result,
            outcome === "cancelled"
              ? /authorization_cancelled/
              : /authorization_failed/,
          );
    await entered.promise;
    assert.deepEqual(phases, ["exchanging", "validating", "committing_grant"]);
    if (outcome === "cancelled") controller.abort();
    commit.resolve();
    if (rejected) await rejected;
    else assert.equal((await result).accessToken, token.accessToken);
    assert.equal(
      phases.at(-1),
      outcome === "success"
        ? "complete"
        : outcome === "cancelled"
          ? "cancelled"
          : "failed",
    );
    assert.equal(phases.includes("complete"), outcome === "success");
  });
}

test("both browser wrappers await their asynchronous commit dependency", async () => {
  for (const operation of [
    (deps) => authorizeWithBrowser(hosted, {}, deps),
    (deps) => createBrowserAuthorizationSession(deps).authorize(hosted),
  ]) {
    const phases = [];
    const entered = deferred();
    const commit = deferred();
    const result = operation(
      dependencies(phases, {
        commitGrant: async () => {
          entered.resolve();
          await commit.promise;
        },
      }),
    );
    await entered.promise;
    assert.equal(phases.includes("complete"), false);
    commit.resolve();
    assert.equal(await result, token.accessToken);
    assert.equal(phases.at(-1), "complete");
  }
});

test("memory grant exposes verified metadata and refreshed expiry for secure commit", async () => {
  let now = 1_000;
  const grant = await authorizeGrantWithBrowser(
    hosted,
    {},
    dependencies([]),
    () => now,
    (candidate) => candidate,
  );
  assert.equal(grant.expiresAt, 61_000);
  now = 30_000;
  const refreshed = await grant.refresh();
  assert.equal(refreshed.expiresAt, 90_000);
  assert.equal(refreshed.refreshToken, "rotated-refresh-token");
  assert.equal(refreshed.subject, token.subject);
  assert.deepEqual(refreshed.scopes, token.scopes);
});

test("memory grant rejects overflowed expiry before commit", async () => {
  const deps = dependencies([]);
  const prepare = deps.prepare;
  deps.prepare = async () => ({
    ...(await prepare()),
    exchange: async () => ({ ...token, expiresInSeconds: 1e308 }),
  });
  await assert.rejects(
    authorizeGrantWithBrowser(hosted, {}, deps, Date.now, () =>
      assert.fail("must not commit"),
    ),
    /authorization_token_missing/,
  );
});
