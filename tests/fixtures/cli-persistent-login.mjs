import assert from "node:assert/strict";
import { createPersistentLoginSession } from "../../packages/cli/dist/persistent-login.js";
import { HostedTestBlockedError } from "../../packages/cli/dist/hosted-errors.js";

export const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "synthetic-client",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

export function model() {
  const state = {
    stored: null,
    opened: 0,
    refreshes: [],
    writes: [],
    phases: [],
    subject: "synthetic-person-a",
    token: 0,
    unavailable: false,
  };
  let queue = Promise.resolve();
  const tokens = () => ({
    accessToken: `access-${++state.token}`,
    refreshToken: `refresh-${state.token}`,
    expiresInSeconds: 3600,
    subject: state.subject,
    scopes: ["email"],
  });
  const deps = {
    store: {
      read: async () => {
        if (state.unavailable)
          throw new HostedTestBlockedError("secure_storage_unavailable");
        return state.stored;
      },
      write: async (value) => {
        state.writes.push(value);
        state.stored = value;
      },
      remove: async () => {
        state.stored = null;
      },
    },
    withLock: async (operation) => {
      const prior = queue;
      let release;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        return await operation();
      } finally {
        release();
      }
    },
    browser: {
      prepare: async () => assert.fail("use persistent prepared grant"),
      openBrowser: async () => {
        state.opened++;
        return true;
      },
      listenForOAuthCallback: async () => ({
        callback: Promise.resolve(
          new URL("http://127.0.0.1:49671/callback?code=synthetic&state=state"),
        ),
        transition: (phase) => state.phases.push(phase),
        finish: (phase) => state.phases.push(phase),
      }),
    },
    prepareLogin: async () => ({
      state: "state",
      authorizationUrl: new URL("https://identity.example.test/authorize"),
      exchange: async () => tokens(),
    }),
    refreshGrant: async (_hosted, refreshToken, subject) => {
      state.refreshes.push(refreshToken);
      assert.equal(subject, state.subject);
      return tokens();
    },
  };
  return { state, deps, session: () => createPersistentLoginSession(deps) };
}

export function program(session, additions = {}) {
  return {
    cwd: "/synthetic-unused",
    randomUUID: () => assert.fail("auth creates no operation authority"),
    runner: {},
    auth: { session, fetch: async () => Response.json(hosted) },
    authExec: {
      fetch: async () => Response.json(hosted),
      authorize: session.authorize,
      spawn: async (_command, _args, token) => assert.match(token, /^access-/),
    },
    ...additions,
  };
}
