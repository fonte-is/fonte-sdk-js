import assert from "node:assert/strict";
import test from "node:test";

import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { parseSessionRecord } from "../packages/cli/dist/persistent-login-record.js";
import {
  binding,
  deferred,
  model,
  reason,
} from "./fixtures/cli-persistent-login.mjs";

const interactive = { switchAccount: false, interactive: true };

test("ten independent sessions reuse one explicit login and serialize every rotation", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  const handles = [];
  for (let index = 0; index < 10; index++)
    handles.push(await m.session().authorize(binding));
  assert.equal(m.state.opened, 1);
  assert.equal(m.state.renewals.length, 10);
  assert.deepEqual(
    m.state.renewals,
    Array.from({ length: 10 }, (_, index) => `refresh-${index + 1}`),
  );
  assert.equal(new Set(handles.map(({ accessToken }) => accessToken)).size, 10);
  assert.ok(
    m.state.replacements.every(
      (record) => !JSON.stringify(record).includes("access-"),
    ),
  );
});

test("concurrent fresh processes rotate in order without stale writeback", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  const handles = await Promise.all(
    Array.from({ length: 10 }, () => m.session().authorize(binding)),
  );
  assert.equal(new Set(handles.map(({ accessToken }) => accessToken)).size, 10);
  assert.deepEqual(
    m.state.renewals,
    Array.from({ length: 10 }, (_, index) => `refresh-${index + 1}`),
  );
});

test("force refresh for an observed generation coalesces after another call advances it", async () => {
  const m = model();
  const session = m.session();
  const first = await session.login(binding, interactive);
  const handles = await Promise.all(
    Array.from({ length: 10 }, () =>
      session.refresh(binding, { observedGeneration: first.generation }),
    ),
  );
  assert.equal(m.state.renewals.length, 1);
  assert.equal(new Set(handles.map(({ accessToken }) => accessToken)).size, 1);
  assert.ok(handles[0].generation > first.generation);
});

test("pre-exchange provider and configuration failures preserve ready custody", async () => {
  for (const outcome of [
    {
      tag: "retryable_before_exchange",
      reason: "provider_unavailable",
      exchangeSubmitted: false,
      expected: "login_refresh_unavailable",
    },
    {
      tag: "rejected_configuration",
      reason: "configuration_rejected",
      exchangeSubmitted: false,
      expected: "authorization_failed",
    },
  ]) {
    const m = model();
    await m.session().login(binding, interactive);
    const ready = structuredClone(m.state.record);
    m.state.renewHook = async () => outcome;
    await assert.rejects(
      m.session().authorize(binding),
      reason(outcome.expected),
    );
    assert.deepEqual(m.state.record, ready);
  }
});

test("definitive pre-exchange outcomes after the marker restore ready custody", async () => {
  for (const outcome of [
    {
      tag: "retryable_before_exchange",
      reason: "provider_unavailable",
      exchangeSubmitted: false,
      expected: "login_refresh_unavailable",
    },
    {
      tag: "rejected_configuration",
      reason: "configuration_rejected",
      exchangeSubmitted: false,
      expected: "authorization_failed",
    },
    {
      tag: "cancelled_before_exchange",
      reason: "cancelled",
      exchangeSubmitted: false,
      expected: "authorization_cancelled",
    },
  ]) {
    const m = model();
    await m.session().login(binding, interactive);
    const refreshToken = m.state.record.refreshToken;
    const generation = m.state.record.generation;
    m.state.renewHook = async ({ beforeExchange }) => {
      await beforeExchange();
      return outcome;
    };
    await assert.rejects(
      m.session().authorize(binding),
      reason(outcome.expected),
    );
    assert.equal(m.state.record.state, "ready");
    assert.equal(m.state.record.refreshToken, refreshToken);
    assert.ok(m.state.record.generation > generation);
  }
});

test("beforeExchange storage failure submits nothing and preserves ready custody", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  const ready = structuredClone(m.state.record);
  let submitted = false;
  m.state.replaceHook = async (record) => {
    if (record.state === "refresh_pending")
      throw new HostedTestBlockedError("secure_storage_unavailable");
  };
  m.state.renewHook = async ({ beforeExchange, grant }) => {
    await beforeExchange();
    submitted = true;
    return { tag: "success", exchangeSubmitted: true, ...grant() };
  };
  await assert.rejects(
    m.session().authorize(binding),
    reason("secure_storage_unavailable"),
  );
  assert.equal(submitted, false);
  assert.deepEqual(m.state.record, ready);
});

test("lost exchange response and failed successor commit retain quarantined state", async () => {
  const uncertain = model();
  await uncertain.session().login(binding, interactive);
  uncertain.state.renewHook = async ({ beforeExchange }) => {
    await beforeExchange();
    return {
      tag: "exchange_uncertain",
      reason: "exchange_uncertain",
      exchangeSubmitted: true,
    };
  };
  await assert.rejects(
    uncertain.session().authorize(binding),
    reason("login_refresh_uncertain"),
  );
  assert.equal(uncertain.state.record.state, "refresh_uncertain");
  assert.match(uncertain.state.record.refreshToken, /^refresh-/);

  const failedCommit = model();
  await failedCommit.session().login(binding, interactive);
  failedCommit.state.replaceHook = async (record) => {
    if (record.state === "ready" && record.generation > 1)
      throw new HostedTestBlockedError("secure_storage_unavailable");
  };
  await assert.rejects(
    failedCommit.session().authorize(binding),
    reason("secure_storage_unavailable"),
  );
  assert.equal(failedCommit.state.record.state, "refresh_pending");
  await assert.rejects(
    failedCommit.session().authorize(binding),
    reason("login_refresh_uncertain"),
  );
  assert.equal(failedCommit.state.record.state, "refresh_uncertain");
});

test("an abandoned refresh marker is quarantined and never replayed", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  m.state.record = {
    ...m.state.record,
    state: "refresh_pending",
    generation: m.state.record.generation + 1,
  };
  m.state.renewHook = async () =>
    assert.fail("an abandoned rotating credential must not be replayed");
  await assert.rejects(
    m.session().authorize(binding),
    reason("login_refresh_uncertain"),
  );
  assert.equal(m.state.record.state, "refresh_uncertain");
});

test("logout fences a browser completion that was already waiting", async () => {
  const m = model();
  const entered = deferred();
  const release = deferred();
  m.state.loginHook = async ({ grant }) => ({
    complete: async (commit) => {
      m.state.opened += 1;
      entered.resolve();
      await release.promise;
      const candidate = grant();
      await commit(candidate);
      return candidate;
    },
  });
  const login = m.session().login(binding, interactive);
  await entered.promise;
  const logout = await m.session().logout();
  assert.equal(logout.local, "cleared");
  assert.equal(logout.remote, "unsupported");
  release.resolve();
  await assert.rejects(login, reason("login_changed"));
  assert.equal(m.state.record.state, "signed_out");
  assert.equal("refreshToken" in m.state.record, false);
});

test("logout waits through a living refresh owner then replaces its result", async () => {
  const m = model();
  const active = m.session();
  await active.login(binding, interactive);
  const entered = deferred();
  const release = deferred();
  m.state.renewHook = async ({ beforeExchange, subject, grant }) => {
    await beforeExchange();
    entered.resolve();
    await release.promise;
    return {
      tag: "success",
      exchangeSubmitted: true,
      ...grant(subject),
    };
  };
  const refresh = active.refresh(binding, {
    observedGeneration: m.state.record.generation,
  });
  await entered.promise;
  const logout = m.session().logout();
  release.resolve();
  await refresh;
  assert.equal((await logout).local, "cleared");
  assert.equal(m.state.record.state, "signed_out");
});

test("late cancellation cannot remove a newer account login", async () => {
  const m = model();
  const entered = deferred();
  const release = deferred();
  let attempt = 0;
  m.state.loginHook = async ({ grant }) => {
    attempt += 1;
    if (attempt === 1)
      return {
        complete: async (commit) => {
          m.state.opened += 1;
          entered.resolve();
          await release.promise;
          const candidate = grant("synthetic-person-a");
          await commit(candidate);
          return candidate;
        },
      };
    return {
      complete: async (commit) => {
        m.state.opened += 1;
        const candidate = grant("synthetic-person-b");
        await commit(candidate);
        return candidate;
      },
    };
  };
  const cancellation = new AbortController();
  const oldLogin = m
    .session()
    .login(binding, { ...interactive, signal: cancellation.signal });
  await entered.promise;
  await m.session().logout();
  await m.session().login(binding, { ...interactive, switchAccount: true });
  const newer = structuredClone(m.state.record);
  cancellation.abort();
  release.resolve();
  await assert.rejects(oldLogin);
  assert.deepEqual(m.state.record, newer);
  assert.equal(m.state.record.subject, "synthetic-person-b");
});

test("a surviving process rejects an explicit account replacement", async () => {
  const m = model();
  const survivor = m.session();
  await survivor.login(binding, interactive);
  await m.session().login(binding, { ...interactive, switchAccount: true });
  await assert.rejects(survivor.authorize(binding), reason("login_changed"));
  assert.equal(m.state.opened, 2);
});

test("missing, inaccessible, interaction-required and corrupt custody stay distinct", async () => {
  const missing = model();
  await assert.rejects(
    missing.session().authorize(binding),
    reason("login_required"),
  );
  for (const failure of [
    "secure_storage_unavailable",
    "secure_storage_interaction_required",
  ]) {
    const m = model();
    m.state.storeFault = failure;
    await assert.rejects(m.session().authorize(binding), reason(failure));
  }
  const corrupt = model();
  corrupt.state.record = { schema: "foreign", refreshToken: "secret" };
  await assert.rejects(
    corrupt.session().authorize(binding),
    reason("login_invalid"),
  );
});

test("slow storage cannot extend or return an expired bearer", async () => {
  const m = model();
  m.state.replaceHook = async (record) => {
    if (record.state === "ready") m.state.now += 3_600_001;
  };
  await assert.rejects(
    m.session().login(binding, interactive),
    reason("authorization_failed"),
  );
  assert.equal(m.state.record.state, "ready");
  assert.equal(m.state.opened, 1);
  m.state.replaceHook = null;
  await m.session().authorize(binding);
  assert.equal(m.state.renewals.length, 1);
});

test("logout returns a failed local receipt when custody cannot be replaced", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  m.state.storeFault = "secure_storage_unavailable";
  assert.deepEqual(await m.session().logout(), {
    local: "failed",
    remote: "unsupported",
  });
  m.state.storeFault = null;
  assert.equal(m.state.record.state, "ready");
});

test("exact binding mismatch does not refresh or fall back", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  for (const changed of [
    { issuer: "https://other.example.test" },
    { clientId: "synthetic-other" },
    { scopes: ["email", "profile"] },
    { coreApiTarget: "https://other-api.example.test" },
    { redirectUri: "http://127.0.0.1:49999/callback" },
  ]) {
    await assert.rejects(
      m.session().authorize({ ...binding, ...changed }),
      reason("login_changed"),
    );
  }
  assert.equal(m.state.renewals.length, 0);
});

test("pending login expires after process death and late completion cannot resurrect it", async () => {
  const m = model();
  const entered = deferred();
  const release = deferred();
  let attempt = 0;
  m.state.loginHook = async ({ grant }) => {
    attempt += 1;
    if (attempt === 1)
      return {
        complete: async (commit) => {
          entered.resolve();
          await release.promise;
          const candidate = grant();
          await commit(candidate);
          return candidate;
        },
      };
    return {
      complete: async (commit) => {
        const candidate = grant();
        await commit(candidate);
        return candidate;
      },
    };
  };
  const abandoned = m.session().login(binding, interactive);
  await entered.promise;
  m.state.now += 300_001;
  await assert.rejects(
    m.session().authorize(binding),
    reason("login_required"),
  );
  await m.session().login(binding, interactive);
  const replacement = structuredClone(m.state.record);
  release.resolve();
  await assert.rejects(abandoned, reason("login_changed"));
  assert.deepEqual(m.state.record, replacement);
});

test("noninteractive login fails before storage or browser effects", async () => {
  const m = model();
  await assert.rejects(
    m.session().login(binding, {
      switchAccount: false,
      interactive: false,
    }),
    reason("authorization_interaction_required"),
  );
  assert.equal(m.state.reads, 0);
  assert.equal(m.state.opened, 0);
});

test("status is local-only and serialization exposes no bearer or credential", async () => {
  const m = model();
  const session = m.session();
  await session.login(binding, interactive);
  const status = await m.session().status();
  assert.equal(status.state, "ready");
  assert.equal(status.serverCheck, "not_checked");
  assert.equal(m.state.renewals.length, 0);
  assert.doesNotMatch(
    JSON.stringify(session),
    /access-|refresh-|synthetic-person|refreshToken/,
  );
  assert.throws(
    () =>
      parseSessionRecord({
        ...m.state.record,
        accessToken: "must-not-persist",
      }),
    reason("login_invalid"),
  );
});

test("invalid grant is revoked while identity mismatch is quarantined", async () => {
  for (const outcome of [
    {
      tag: "rejected_invalid_grant",
      reason: "invalid_grant",
      exchangeSubmitted: true,
      state: "revoked",
      error: "login_revoked",
    },
    {
      tag: "identity_mismatch",
      reason: "subject_mismatch",
      exchangeSubmitted: true,
      state: "refresh_uncertain",
      error: "login_changed",
    },
  ]) {
    const m = model();
    await m.session().login(binding, interactive);
    m.state.renewHook = async ({ beforeExchange }) => {
      await beforeExchange();
      return outcome;
    };
    await assert.rejects(m.session().authorize(binding), reason(outcome.error));
    assert.equal(m.state.record.state, outcome.state);
  }
});

test("a malformed tagged success is quarantined instead of leaving a replayable marker", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  m.state.renewHook = async ({ beforeExchange, grant }) => {
    await beforeExchange();
    return {
      tag: "success",
      exchangeSubmitted: true,
      ...grant(),
      expiresAt: Number.NaN,
    };
  };
  await assert.rejects(
    m.session().authorize(binding),
    reason("login_refresh_uncertain"),
  );
  assert.equal(m.state.record.state, "refresh_uncertain");
});

test("submitted success without its marker is quarantined", async () => {
  const m = model();
  await m.session().login(binding, interactive);
  m.state.renewHook = async ({ grant }) => ({
    tag: "success",
    exchangeSubmitted: true,
    ...grant(),
  });
  await assert.rejects(
    m.session().authorize(binding),
    reason("login_refresh_uncertain"),
  );
  assert.equal(m.state.record.state, "refresh_uncertain");
});

test("generation overflow and malformed pending timestamps fail login_invalid", async () => {
  const overflow = model();
  await overflow.session().login(binding, interactive);
  overflow.state.record.generation = Number.MAX_SAFE_INTEGER;
  await assert.rejects(
    overflow.session().authorize(binding),
    reason("login_invalid"),
  );
  assert.equal(overflow.state.record.generation, Number.MAX_SAFE_INTEGER);

  for (const expiresAt of [1_299_999, Number.NaN]) {
    const malformed = model();
    malformed.state.record = {
      schema: "fonte.client_session.v1",
      state: "login_pending",
      binding,
      loginId: "00000000-0000-4000-8000-000000000001",
      epoch: "00000000-0000-4000-8000-000000000002",
      generation: 0,
      createdAt: 1_000_000,
      expiresAt,
    };
    await assert.rejects(
      malformed.session().authorize(binding),
      reason("login_invalid"),
    );
  }
});
