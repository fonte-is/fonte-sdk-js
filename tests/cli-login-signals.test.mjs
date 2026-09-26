import assert from "node:assert/strict";
import test from "node:test";

import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { createPersistentLoginSession } from "../packages/cli/dist/persistent-login.js";
import {
  binding,
  deferred,
  model,
  reason,
} from "./fixtures/cli-persistent-login.mjs";

test("cancelling browser wait cleans only its pending epoch", async () => {
  const m = model();
  const entered = deferred();
  m.state.loginHook = async ({ signal }) => ({
    complete: async () => {
      m.state.opened += 1;
      entered.resolve();
      await new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new HostedTestBlockedError("authorization_cancelled")),
          { once: true },
        );
      });
    },
  });
  const cancellation = new AbortController();
  const login = m.session().login(binding, {
    switchAccount: false,
    interactive: true,
    signal: cancellation.signal,
  });
  await entered.promise;
  cancellation.abort(new Error("synthetic private cancellation detail"));
  await assert.rejects(login, reason("authorization_cancelled"));
  assert.equal(m.state.record.state, "signed_out");
  assert.equal("refreshToken" in m.state.record, false);
  assert.doesNotMatch(
    JSON.stringify(m.state.replacements),
    /private cancellation detail/,
  );
});

test("cancellation after possible token submission remains uncertain", async () => {
  const m = model();
  await m.session().login(binding, {
    switchAccount: false,
    interactive: true,
  });
  const cancellation = new AbortController();
  m.state.renewHook = async ({ beforeExchange }) => {
    await beforeExchange();
    cancellation.abort(new Error("synthetic provider detail"));
    return {
      tag: "exchange_uncertain",
      reason: "exchange_uncertain",
      exchangeSubmitted: true,
    };
  };
  await assert.rejects(
    m.session().authorize(binding, { signal: cancellation.signal }),
    reason("login_refresh_uncertain"),
  );
  assert.equal(m.state.record.state, "refresh_uncertain");
  assert.doesNotMatch(
    JSON.stringify(m.state.replacements),
    /synthetic provider detail/,
  );
});

test("legacy adapter treats abort after refresh invocation as uncertain", async () => {
  const cancellation = new AbortController();
  const hosted = {
    schema: "fonte.cli.hosted_config.v1",
    authorizationServer: binding.issuer,
    clientId: binding.clientId,
    coreApiBaseUrl: binding.coreApiTarget,
    redirectUri: binding.redirectUri,
    scopes: ["email"],
  };
  let stored = JSON.stringify({
    schema: "fonte.client_session.v1",
    state: "ready",
    binding,
    loginId: "00000000-0000-4000-8000-000000000001",
    subject: "synthetic-subject",
    refreshToken: "synthetic-refresh",
    epoch: "00000000-0000-4000-8000-000000000002",
    generation: 0,
  });
  const session = createPersistentLoginSession({
    store: {
      read: async () => stored,
      write: async (value) => {
        stored = value;
      },
      remove: async () => assert.fail("v1 logout uses replacement"),
    },
    withLock: async (operation) => operation(),
    browser: {
      prepare: async () => assert.fail("authorize never prepares login"),
      openBrowser: async () => assert.fail("authorize never opens a browser"),
      listenForOAuthCallback: async () =>
        assert.fail("authorize never listens for a callback"),
    },
    prepareLogin: async () => assert.fail("authorize never prepares login"),
    refreshGrant: async () => {
      cancellation.abort(new Error("synthetic post-invocation detail"));
      throw new Error("synthetic lost response");
    },
  });
  await assert.rejects(
    session.authorize(hosted, cancellation.signal),
    reason("login_refresh_uncertain"),
  );
  assert.equal(JSON.parse(stored).state, "refresh_uncertain");
  assert.doesNotMatch(stored, /post-invocation detail|lost response/);
});

test("an already aborted explicit login has no store or browser effects", async () => {
  const m = model();
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(
    m.session().login(binding, {
      switchAccount: false,
      interactive: true,
      signal: cancellation.signal,
    }),
  );
  assert.equal(m.state.record, null);
  assert.equal(m.state.opened, 0);
  assert.equal(m.state.replacements.length, 0);
});
