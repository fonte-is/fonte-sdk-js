import assert from "node:assert/strict";
import test from "node:test";
import { runProgram } from "../packages/cli/dist/program.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";

import { hosted, model, program } from "./fixtures/cli-persistent-login.mjs";

test("ten distinct session instances reuse one browser login and commit every rotation", async () => {
  const m = model();
  await m.session().login(hosted);
  for (let i = 0; i < 10; i++) {
    const session = m.session();
    const result = await runProgram(
      ["auth", "exec", "--", "synthetic-child"],
      program(session),
    );
    assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
    assert.equal(JSON.parse(m.state.stored).refreshToken, `refresh-${i + 2}`);
    assert.equal(await session.authorize(hosted), `access-${i + 2}`);
  }
  assert.equal(m.state.opened, 1);
  assert.equal(m.state.refreshes.length, 10);
  assert.deepEqual(
    m.state.refreshes,
    Array.from({ length: 10 }, (_, i) => `refresh-${i + 1}`),
  );
  assert.ok(m.state.writes.every((value) => !value.includes("access-")));
});

test("parallel invocations consume the latest rotation under exclusion", async () => {
  const m = model();
  await m.session().login(hosted);
  const result = await Promise.all(
    Array.from({ length: 10 }, () => m.session().authorize(hosted)),
  );
  assert.equal(new Set(result).size, 10);
  assert.equal(m.state.opened, 1);
  assert.deepEqual(
    m.state.refreshes,
    Array.from({ length: 10 }, (_, i) => `refresh-${i + 1}`),
  );
});

test("logout waits for a pending rotation, removes custody, and fences an existing process", async () => {
  const m = model();
  const active = m.session();
  await active.login(hosted);
  let release;
  let entered;
  const began = new Promise((resolve) => {
    entered = resolve;
  });
  const original = m.deps.refreshGrant;
  m.deps.refreshGrant = async (...args) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return original(...args);
  };
  const refreshing = active.refresh(hosted);
  await began;
  const logout = m.session().logout();
  release();
  await refreshing;
  await logout;
  assert.equal(m.state.stored, null);
  await assert.rejects(active.authorize(hosted), /login_required/);
  assert.equal(m.state.opened, 1);
  await m.session().authorize(hosted);
  assert.equal(m.state.opened, 2);
});

test("issuer, client, scope, API, callback and identity changes never reuse an old sign-in", async () => {
  for (const change of [
    { authorizationServer: "https://foreign.example.test" },
    { clientId: "different-client" },
    { scopes: ["email", "profile"] },
    { coreApiBaseUrl: "https://other.example.test" },
    { redirectUri: "http://127.0.0.1:49999/callback" },
  ]) {
    const m = model();
    await m.session().login(hosted);
    await assert.rejects(
      m.session().authorize({ ...hosted, ...change }),
      /login_changed/,
    );
    assert.equal(m.state.refreshes.length, 0);
    assert.equal(m.state.opened, 1);
  }
  const m = model();
  const active = m.session();
  await active.login(hosted);
  m.state.subject = "synthetic-person-b";
  await m.session().login(hosted, true);
  await assert.rejects(active.authorize(hosted), /login_changed/);
  assert.equal(m.state.opened, 2);
});

test("revoked, mismatched, or uncertain refresh fails closed without opening the browser", async () => {
  for (const behavior of [
    async () => {
      throw new Error("refresh-secret-in-provider-error");
    },
    async () => ({
      accessToken: "foreign-access",
      refreshToken: "foreign-refresh",
      subject: "foreign",
      expiresInSeconds: 60,
    }),
  ]) {
    const m = model();
    await m.session().login(hosted);
    m.deps.refreshGrant = behavior;
    const result = await runProgram(
      ["auth", "exec", "--", "child"],
      program(m.session()),
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.stderr, /fonte auth login/);
    assert.doesNotMatch(
      JSON.stringify(result),
      /refresh-secret|foreign-access|foreign-refresh/,
    );
    assert.equal(m.state.stored, null);
    assert.equal(m.state.opened, 1);
  }
});

test("missing login status and offline logout need neither browser nor project", async () => {
  const m = model();
  const absent = await runProgram(
    ["auth", "status", "--json"],
    program(m.session()),
  );
  assert.equal(absent.exitCode, 3);
  assert.equal(JSON.parse(absent.stdout).state, "signed_out");
  await m.session().login(hosted);
  const session = m.session();
  const result = await runProgram(
    ["auth", "logout", "--json"],
    program(session, {
      auth: {
        session,
        fetch: async () => assert.fail("logout must not fetch discovery"),
      },
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(m.state.stored, null);
  assert.equal(m.state.opened, 1);
});

test("unavailable/corrupt store gives bounded recovery before browser or child", async () => {
  for (const fault of ["unavailable", "corrupt"]) {
    const m = model();
    m.state.unavailable = fault === "unavailable";
    m.state.stored = fault === "corrupt" ? "malformed-secret" : null;
    const result = await runProgram(
      ["auth", "exec", "--", "child"],
      program(m.session()),
    );
    assert.equal(result.exitCode, 3);
    assert.equal(m.state.opened, 0);
    assert.match(result.stderr, /fonte auth login/);
    assert.doesNotMatch(result.stderr, /malformed-secret/);
  }
});

test("failed durable write does not display callback success or return a bearer", async () => {
  const m = model();
  m.deps.store.write = async () => {
    throw new HostedTestBlockedError("secure_storage_unavailable");
  };
  await assert.rejects(m.session().login(hosted), /secure_storage_unavailable/);
  assert.equal(m.state.phases.includes("complete"), false);
  assert.equal(m.state.stored, null);
});

test("auth commands admit only their own flags and safe help", async () => {
  const m = model();
  for (const argv of [
    ["auth", "status", "--switch-account"],
    ["auth", "login", "--token", "secret"],
    ["auth", "logout", "--json", "--json"],
  ]) {
    const result = await runProgram(argv, program(m.session()));
    assert.equal(result.exitCode, 2);
    assert.doesNotMatch(result.stdout + result.stderr, /secret/);
  }
  const help = await runProgram(
    ["auth", "login", "--help"],
    program(m.session()),
  );
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /OS credential store/);
  assert.equal(m.state.opened, 0);
});

test("a crash or failed cleanup after refresh leaves a marker that a new process cannot reuse", async () => {
  const m = model();
  await m.session().login(hosted);
  let captured;
  m.deps.refreshGrant = async () => {
    captured = m.state.stored;
    throw new Error("lost rotation response");
  };
  m.deps.store.remove = async () => {
    throw new HostedTestBlockedError("secure_storage_unavailable");
  };
  await assert.rejects(
    m.session().authorize(hosted),
    /secure_storage_unavailable/,
  );
  assert.deepEqual(JSON.parse(captured), { version: 1, state: "refreshing" });
  assert.equal(m.state.stored, captured);
  m.deps.refreshGrant = async () =>
    assert.fail("an interrupted refresh cannot be retried with its old token");
  await assert.rejects(m.session().authorize(hosted), /login_invalid/);
  assert.equal(m.state.opened, 1);
});

test("cancellation during durable login commit removes that login before returning", async () => {
  const m = model();
  const cancellation = new AbortController();
  const write = m.deps.store.write;
  m.deps.store.write = async (value) => {
    await write(value);
    cancellation.abort();
  };
  await assert.rejects(
    m.session().login(hosted, false, cancellation.signal),
    /authorization_cancelled/,
  );
  assert.equal(m.state.stored, null);
  assert.equal(m.state.phases.includes("complete"), false);
});

test("serializing a live session exposes no credential state", async () => {
  const m = model();
  const session = m.session();
  await session.login(hosted);
  const serialized = JSON.stringify(session);
  assert.doesNotMatch(
    serialized,
    /access-|refresh-|synthetic-person|refreshToken/,
  );
});

test("credential storage latency cannot extend a bearer lifetime or complete an expired login", async () => {
  for (const elapsed of [3_580_000, 3_600_001]) {
    const m = model();
    let now = 0;
    m.deps.now = () => now;
    const write = m.deps.store.write;
    m.deps.store.write = async (value) => {
      await write(value);
      now += elapsed;
    };
    const session = m.session();
    if (elapsed > 3_600_000) {
      await assert.rejects(session.login(hosted), /login_invalid/);
      assert.equal(m.state.stored, null);
      assert.equal(m.state.phases.includes("complete"), false);
    } else {
      await session.login(hosted);
      m.deps.store.write = write;
      await session.authorize(hosted);
      assert.equal(m.state.refreshes.length, 1);
    }
  }
});
