import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { realpath } from "node:fs/promises";

import { runAuthCommand } from "../packages/cli/dist/auth-commands.js";
import { createClientAuthRuntime } from "../packages/cli/dist/client-auth-runtime.js";
import { CLIENT_SESSION_SCHEMA } from "../packages/cli/dist/client-auth-types.js";
import { ClientAuthStoreSelector } from "../packages/cli/dist/credential-store/store-selection.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { runProgram } from "../packages/cli/dist/program.js";

const config = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const binding = {
  issuer: config.authorizationServer,
  clientId: config.clientId,
  scopes: config.scopes,
  coreApiTarget: config.coreApiBaseUrl,
  redirectUri: config.redirectUri,
};
const ready = {
  state: "ready",
  binding,
  loginId: "10000000-0000-4000-8000-000000000001",
  subject: "customer-subject",
  epoch: "10000000-0000-4000-8000-000000000002",
  generation: 4,
  serverCheck: "not_checked",
};
const handle = {
  accessToken: "opaque-access-token",
  loginId: ready.loginId,
  epoch: ready.epoch,
  generation: ready.generation,
  expiresAt: 9_000_000,
};

test("auth v2 receipts distinguish issued login, offline status, and local-only logout", async () => {
  let statusCalls = 0;
  const session = {
    login: async () => ({
      handle: { ...handle, generation: 5 },
      status: { ...ready, generation: 5 },
      serverCheck: "token_issued",
    }),
    status: async () => {
      statusCalls += 1;
      return ready;
    },
    logout: async () => ({ local: "cleared", remote: "unsupported" }),
  };

  const login = await runAuthCommand("login", false, true, { session });
  assert.deepEqual(JSON.parse(login.stdout), {
    schema_version: "fonte.cli.auth.v2",
    command: "auth login",
    outcome: "completed",
    state: "signed_in_local",
    reason: "ok",
    session: {
      subject: "customer-subject",
      issuer: binding.issuer,
      client_id: binding.clientId,
      core_api_base_url: binding.coreApiTarget,
    },
    server_check: "token_issued",
    local_logout: null,
    remote_revocation: null,
    next_action: null,
  });
  assert.equal(login.stdout.endsWith("\n"), true);
  assert.equal(login.stderr, "");

  const status = await runAuthCommand("status", false, true, { session });
  assert.equal(status.exitCode, 0);
  assert.equal(statusCalls, 1);
  assert.equal(status.receipt.server_check, "not_checked");

  const logout = await runAuthCommand("logout", false, true, { session });
  assert.equal(logout.exitCode, 0);
  assert.equal(logout.receipt.local_logout, "cleared");
  assert.equal(logout.receipt.remote_revocation, "unsupported");
  assert.equal(
    (await runAuthCommand("logout", false, false, { session })).stdout,
    "Signed out of Fonte.\n",
  );
});

test("offline status maps every local lifecycle state without discovery or renewal", async () => {
  const cases = [
    ["absent", "signed_out", "login_required", "login"],
    ["signed_out", "signed_out", "login_required", "login"],
    ["login_pending_expired", "signed_out", "login_required", "login"],
    ["login_pending", "login_pending", "login_busy", "retry"],
    [
      "refresh_pending",
      "refresh_uncertain",
      "login_refresh_uncertain",
      "login",
    ],
    [
      "refresh_uncertain",
      "refresh_uncertain",
      "login_refresh_uncertain",
      "login",
    ],
    ["revoked", "revoked", "login_revoked", "login"],
  ];
  for (const [local, state, reason, next] of cases) {
    const localStatus = [
      "refresh_pending",
      "refresh_uncertain",
      "revoked",
    ].includes(local)
      ? { ...ready, state: local }
      : { state: local, serverCheck: "not_checked" };
    const result = await runAuthCommand("status", false, true, {
      session: {
        status: async () => localStatus,
        login: async () => assert.fail("status must not log in"),
        logout: async () => assert.fail("status must not log out"),
      },
    });
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.state, state);
    assert.equal(result.receipt.reason, reason);
    assert.equal(result.receipt.next_action.kind, next);
    assert.equal(result.receipt.server_check, "not_checked");
  }
});

test("typed custody failures select bounded recovery without raw diagnostics", async () => {
  const cases = [
    ["secure_storage_interaction_required", "unlock_credential_store"],
    ["secure_storage_unavailable", "select_user_private_store"],
    ["login_refresh_unavailable", "retry"],
    ["login_refresh_uncertain", "login"],
    ["login_invalid", "login"],
  ];
  for (const [reason, next] of cases) {
    const result = await runAuthCommand("status", false, true, {
      session: failingSession(reason),
    });
    assert.equal(result.exitCode, 3);
    assert.equal(result.receipt.reason, reason);
    assert.equal(result.receipt.next_action.kind, next);
    assert.equal(result.stdout.includes("native diagnostic"), false);
  }

  const failedLogout = await runAuthCommand("logout", false, true, {
    session: {
      status: async () => assert.fail(),
      login: async () => assert.fail(),
      logout: async () => ({ local: "failed", remote: "unsupported" }),
    },
  });
  assert.equal(failedLogout.exitCode, 3);
  assert.equal(failedLogout.receipt.local_logout, "failed");
  assert.equal(failedLogout.receipt.remote_revocation, "unsupported");
});

test("interactive login selects file storage once after native custody is unavailable", async () => {
  const directory = await privateTempDirectory();
  let nativeReads = 0;
  let prompts = 0;
  let browserAuthorizations = 0;
  const selector = new ClientAuthStoreSelector({
    directory,
    nativeStore: {
      read: async () => {
        nativeReads += 1;
        throw new HostedTestBlockedError("secure_storage_unavailable");
      },
      replace: async () => {
        throw new HostedTestBlockedError("secure_storage_unavailable");
      },
    },
  });
  const runtime = createClientAuthRuntime({
    fetch: async () => json(config),
    storageSelection: selector,
    chooseFileStore: async () => {
      prompts += 1;
      return true;
    },
    oauth: {
      prepareExplicitLogin: async () => {
        browserAuthorizations += 1;
        return {
          complete: async (commit) => {
            const grant = {
              accessToken: "synthetic-access-token",
              refreshToken: "synthetic-refresh-token",
              subject: "synthetic-subject",
              scopes: ["email"],
              expiresAt: Date.now() + 3_600_000,
            };
            await commit(grant);
            return grant;
          },
        };
      },
      renew: async () => assert.fail("fresh session must not refresh"),
    },
    withLock: async (operation) => operation(),
  });

  const login = await runtime.login(false);
  assert.equal(login.status.state, "ready");
  assert.equal(prompts, 1);
  assert.equal(browserAuthorizations, 1);
  assert.equal(nativeReads, 1);
  assert.deepEqual(await runtime.storageInfo(), {
    backend: "user_private_file",
    status: "available",
  });
  const choice = await readFile(
    join(directory, "storage-choice.v1.json"),
    "utf8",
  );
  assert.deepEqual(JSON.parse(choice), {
    backend: "file",
    schema: "fonte.auth_storage_choice.v1",
  });
  assert.equal(choice.includes("synthetic-refresh-token"), false);

  const recoveredStatus = await runAuthCommand("status", false, true, {
    session: runtime,
  });
  assert.deepEqual(JSON.parse(recoveredStatus.stdout).storage, {
    backend: "user_private_file",
    status: "available",
  });
  assert.equal(
    recoveredStatus.stdout.includes("synthetic-refresh-token"),
    false,
  );
  assert.equal(
    recoveredStatus.stderr.includes("synthetic-refresh-token"),
    false,
  );

  let routineNativeReads = 0;
  let routinePrompts = 0;
  let routineRefreshes = 0;
  const restarted = createClientAuthRuntime({
    fetch: async () => json(config),
    storageSelection: new ClientAuthStoreSelector({
      directory,
      nativeStore: {
        read: async () => {
          routineNativeReads += 1;
          throw new HostedTestBlockedError("secure_storage_unavailable");
        },
        replace: async () => assert.fail("selected file store must be used"),
      },
    }),
    chooseFileStore: async () => {
      routinePrompts += 1;
      return assert.fail("routine commands never prompt");
    },
    oauth: {
      prepareExplicitLogin: async () =>
        assert.fail("routine commands never log in"),
      renew: async (targetBinding, _refreshToken, subject, options) => {
        routineRefreshes += 1;
        await options.beforeExchange();
        return {
          tag: "success",
          exchangeSubmitted: true,
          accessToken: "synthetic-refreshed-access-token",
          refreshToken: "synthetic-refresh-after-restart",
          subject,
          scopes: targetBinding.scopes,
          expiresAt: Date.now() + 3_600_000,
        };
      },
    },
    withLock: async (operation) => operation(),
    noninteractiveValue: () => "1",
  });
  const accessToken = await restarted.authorize(config);
  assert.equal(accessToken, "synthetic-refreshed-access-token");
  assert.equal(routineRefreshes, 1);
  assert.equal(routineNativeReads, 0);
  assert.equal(routinePrompts, 0);
  const logoutter = createClientAuthRuntime({
    fetch: async () => json(config),
    storageSelection: new ClientAuthStoreSelector({ directory }),
    oauth: {
      prepareExplicitLogin: async () => assert.fail("logout must not log in"),
      renew: async () => assert.fail("logout must not refresh"),
    },
    withLock: async (operation) => operation(),
  });
  await logoutter.logout();
  await assert.rejects(
    restarted.authorize(config),
    (error) =>
      error instanceof HostedTestBlockedError &&
      error.reason === "login_required",
  );
  assert.equal(
    await readFile(join(directory, "session.v1.json")).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(
    await readFile(join(directory, "storage-choice.v1.json"), "utf8").then(
      (text) => text.includes("synthetic-refresh-token"),
    ),
    false,
  );
  assert.equal(
    await readFile(join(directory, "storage-choice.v1.json"), "utf8").then(
      (text) => text.includes("synthetic-refresh-after-restart"),
    ),
    false,
  );
});

test("unexpected auth failures use the execution exit without a misleading receipt", async () => {
  const result = await runAuthCommand("status", false, true, {
    session: {
      status: async () => {
        throw new Error("synthetic unexpected failure");
      },
      login: async () => assert.fail(),
      logout: async () => assert.fail(),
    },
  });
  assert.deepEqual(result, {
    exitCode: 1,
    stdout: "",
    stderr: "Fonte failed: execution_failed.\n",
  });
});

test("runtime status and logout are offline and noninteractive login stops before all effects", async () => {
  let fetches = 0;
  let sessionCalls = 0;
  const session = {
    status: async () => {
      sessionCalls += 1;
      return { state: "absent", serverCheck: "not_checked" };
    },
    logout: async () => {
      sessionCalls += 1;
      return { local: "already_signed_out", remote: "unsupported" };
    },
    login: async () => {
      sessionCalls += 1;
      assert.fail("noninteractive login must stop before session access");
    },
    authorize: async () => assert.fail(),
    refresh: async () => assert.fail(),
  };
  const runtime = createClientAuthRuntime({
    fetch: async () => {
      fetches += 1;
      return json(config);
    },
    session,
    noninteractiveValue: () => "1",
  });
  await runtime.status();
  await runtime.logout();
  await assert.rejects(
    runtime.login(false),
    (error) =>
      error instanceof HostedTestBlockedError &&
      error.reason === "authorization_interaction_required",
  );
  assert.equal(fetches, 0);
  assert.equal(sessionCalls, 2);
});

test("invalid noninteractive values fail before custody while ordinary acquisition never opens login", async () => {
  let reads = 0;
  let browser = 0;
  const invalid = createClientAuthRuntime({
    fetch: async () => assert.fail("invalid mode must not discover"),
    session: {
      status: async () => assert.fail("invalid mode must not read"),
      logout: async () => assert.fail(),
      login: async () => assert.fail(),
      authorize: async () => assert.fail(),
      refresh: async () => assert.fail(),
    },
    noninteractiveValue: () => "true",
  });
  await assert.rejects(invalid.status(), /hosted_configuration_invalid/);

  const missing = createClientAuthRuntime({
    fetch: async () => json(config),
    noninteractiveValue: () => undefined,
    store: {
      read: async () => {
        reads += 1;
        return null;
      },
      replace: async () => assert.fail("missing session must not write"),
    },
    oauth: {
      prepareExplicitLogin: async () => {
        browser += 1;
        assert.fail("ordinary acquisition must not prepare login");
      },
      renew: async () => assert.fail("missing session must not refresh"),
    },
    withLock: async (operation) => operation(),
  });
  await assert.rejects(
    missing.authorize(config),
    (error) =>
      error instanceof HostedTestBlockedError &&
      error.reason === "login_required",
  );
  assert.equal(reads, 1);
  assert.equal(browser, 0);
  assert.equal(missing.credentialPersisted(), false);
});

test("login reports no server check when a suitable in-process token is reused", async () => {
  let statuses = 0;
  const runtime = createClientAuthRuntime({
    fetch: async () => json(config),
    noninteractiveValue: () => undefined,
    session: {
      status: async () => {
        statuses += 1;
        return ready;
      },
      login: async () => handle,
      logout: async () => assert.fail(),
      authorize: async () => assert.fail(),
      refresh: async () => assert.fail(),
    },
  });
  const result = await runtime.login(false);
  assert.equal(result.serverCheck, "not_checked");
  assert.equal(statuses, 2);
  assert.equal(runtime.credentialPersisted(), true);
});

test("auth grammar retains duplicate and unknown flag rejection", async () => {
  const dependencies = {
    cwd: "/unused",
    randomUUID: () => "unused",
    runner: { run: async () => 1 },
  };
  for (const argv of [
    ["auth", "login", "--json", "--json"],
    ["auth", "status", "--switch-account"],
    ["auth", "logout", "--unknown"],
  ]) {
    const result = await runProgram(argv, dependencies);
    assert.equal(result.exitCode, 2);
  }
});

test("session store fixtures never serialize access tokens", async () => {
  const record = {
    schema: CLIENT_SESSION_SCHEMA,
    state: "ready",
    binding,
    loginId: ready.loginId,
    subject: ready.subject,
    refreshToken: "synthetic-refresh-secret",
    epoch: ready.epoch,
    generation: ready.generation,
  };
  assert.equal(JSON.stringify(record).includes(handle.accessToken), false);
});

function failingSession(reason) {
  return {
    status: async () => {
      const error = new HostedTestBlockedError(reason);
      error.message = `native diagnostic ${reason}`;
      throw error;
    },
    login: async () => assert.fail(),
    logout: async () => assert.fail(),
  };
}

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function privateTempDirectory() {
  return mkdtemp(join(await realpath(tmpdir()), "fonte-cli-private-store-"));
}
