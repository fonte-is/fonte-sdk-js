import assert from "node:assert/strict";
import { createClientAuthSession } from "../../packages/cli/dist/persistent-login.js";
import { HostedTestBlockedError } from "../../packages/cli/dist/hosted-errors.js";

export const binding = Object.freeze({
  issuer: "https://identity.example.test/auth/v1",
  clientId: "synthetic-client",
  coreApiTarget: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: Object.freeze(["email"]),
});

export function model() {
  const state = {
    record: null,
    opened: 0,
    renewals: [],
    replacements: [],
    reads: 0,
    now: 1_000_000,
    token: 0,
    uuid: 0,
    storeFault: null,
    replaceHook: null,
    renewHook: null,
    loginHook: null,
  };
  let queue = Promise.resolve();

  const grant = (subject = "synthetic-person-a") => {
    const number = ++state.token;
    return {
      accessToken: `access-${number}`,
      refreshToken: `refresh-${number}`,
      expiresAt: state.now + 3_600_000,
      subject,
      scopes: ["email"],
    };
  };

  const deps = {
    now: () => state.now,
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(++state.uuid).padStart(12, "0")}`,
    withLock: async (operation, signal) => {
      const prior = queue;
      let release;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await prior;
      if (signal?.aborted) {
        release();
        throw new HostedTestBlockedError("login_busy");
      }
      try {
        return await operation();
      } finally {
        release();
      }
    },
    store: {
      read: async () => {
        state.reads += 1;
        if (state.storeFault)
          throw new HostedTestBlockedError(state.storeFault);
        return clone(state.record);
      },
      replace: async (record, options) => {
        if (state.storeFault)
          throw new HostedTestBlockedError(state.storeFault);
        await state.replaceHook?.(record, options);
        state.record = clone(record);
        state.replacements.push(clone(record));
      },
    },
    oauth: {
      prepareExplicitLogin: async (actualBinding, switchAccount, signal) => {
        assert.deepEqual(actualBinding, binding);
        if (state.loginHook)
          return state.loginHook({ switchAccount, signal, grant });
        return {
          complete: async (commit) => {
            state.opened += 1;
            const candidate = grant();
            await commit(candidate);
            return candidate;
          },
        };
      },
      renew: async (
        actualBinding,
        refreshToken,
        subject,
        { beforeExchange, signal },
      ) => {
        assert.deepEqual(actualBinding, binding);
        state.renewals.push(refreshToken);
        if (state.renewHook)
          return state.renewHook({
            refreshToken,
            subject,
            beforeExchange,
            signal,
            grant,
          });
        await beforeExchange();
        return {
          tag: "success",
          exchangeSubmitted: true,
          ...grant(subject),
        };
      },
    },
  };

  return {
    state,
    deps,
    grant,
    session: () => createClientAuthSession(deps),
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function reason(expected) {
  return (error) => {
    assert.ok(error instanceof HostedTestBlockedError);
    assert.equal(error.reason, expected);
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    return true;
  };
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}
