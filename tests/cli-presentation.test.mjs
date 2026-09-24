import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import { parseArguments } from "../packages/cli/dist/arguments.js";
import { humanLoginRecovery } from "../packages/cli/dist/auth-commands.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { REQUIRED_PRODUCT_TOOLS } from "../packages/cli/dist/mcp-readiness.js";
import { renderBlockedOperator } from "../packages/cli/dist/operator-blocked-render.js";
import { runFonteSetup } from "../packages/cli/dist/local-setup.js";
import { runProgram } from "../packages/cli/dist/program.js";

const base = {
  cwd: tmpdir(),
  randomUUID: () => "unused",
  runner: { run: async () => 0 },
};

const binding = {
  issuer: "https://issuer.example.test",
  clientId: "private-client-id",
  coreApiTarget: "https://api.example.test",
};

const hostedConfig = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};

const readySession = {
  state: "ready",
  subject: "private-subject-id",
  binding,
  serverCheck: "not_checked",
};

test("auth status is plain English while JSON stays the auth v2 contract", async () => {
  const session = authDependencies();
  const status = await runProgram(["auth", "status"], {
    ...base,
    auth: { session },
  });
  assert.equal(status.exitCode, 0);
  assert.equal(
    status.stdout,
    [
      "Signed in to Fonte",
      "",
      "Status: Ready",
      "",
      "Your sign-in is stored in a private file on this Mac because Keychain isn't available here.",
      "",
      "Run fonte auth status --verbose for details.",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(
    status.stdout,
    /OAuth|private-subject-id|private-client-id|issuer\.example|user_private_file|server_check|remote_revocation/iu,
  );
  assert.doesNotMatch(status.stdout, /^Account:/mu);

  const native = await runProgram(["auth", "status"], {
    ...base,
    auth: {
      session: authDependencies({
        storage: { backend: "native_secure_store", status: "available" },
      }),
    },
  });
  assert.match(native.stdout, /Your sign-in is saved on this Mac\./u);

  const verbose = await runProgram(["auth", "status", "--verbose"], {
    ...base,
    auth: { session },
  });
  assert.match(verbose.stdout, /Diagnostics:/u);
  assert.match(
    verbose.stdout,
    /Core API endpoint: https:\/\/api\.example\.test/u,
  );
  assert.match(
    verbose.stdout,
    /Credential storage: Private per-user file \(available\)/u,
  );
  assert.match(verbose.stdout, /Session check: Local sign-in only/u);
  assert.doesNotMatch(
    verbose.stdout,
    /private-subject-id|private-client-id|issuer\.example|^\{/mu,
  );

  const json = await runProgram(["auth", "status", "--json"], {
    ...base,
    auth: { session },
  });
  const verboseJson = await runProgram(
    ["auth", "status", "--json", "--verbose"],
    { ...base, auth: { session } },
  );
  assert.deepEqual(JSON.parse(verboseJson.stdout), JSON.parse(json.stdout));
  assert.equal(JSON.parse(json.stdout).schema_version, "fonte.cli.auth.v2");
  assert.equal(JSON.parse(json.stdout).session.subject, "private-subject-id");
});

test("signed-out and expired auth status give one useful next action", async () => {
  const signedOut = await runProgram(["auth", "status"], {
    ...base,
    auth: {
      session: authDependencies({
        status: { state: "absent", serverCheck: "not_checked" },
      }),
    },
  });
  assert.equal(
    signedOut.stdout,
    "Fonte needs you to sign in.\n\nRun:\n  fonte auth login\n",
  );
  assert.equal((signedOut.stdout.match(/fonte auth login/gu) ?? []).length, 1);
  assert.doesNotMatch(signedOut.stdout, /login_required|Reason:|Next:/u);

  const expired = await runProgram(["auth", "status", "--verbose"], {
    ...base,
    auth: {
      session: authDependencies({
        status: { state: "login_pending_expired", serverCheck: "not_checked" },
      }),
    },
  });
  assert.match(
    expired.stdout,
    /^Your previous sign-in didn't finish\.\n\nRun:\n  fonte auth login\n/mu,
  );
  assert.match(expired.stdout, /Reason code: login_pending_expired/u);
  assert.equal((expired.stdout.match(/fonte auth login/gu) ?? []).length, 1);
});

test("login, logout, and recovery messages avoid implementation language", async () => {
  const alreadySignedIn = await runProgram(["auth", "login"], {
    ...base,
    auth: { session: authDependencies({ loginCheck: "not_checked" }) },
  });
  assert.match(alreadySignedIn.stdout, /^You're already signed in to Fonte\./u);

  const login = await runProgram(["auth", "login"], {
    ...base,
    auth: { session: authDependencies({ loginCheck: "token_issued" }) },
  });
  assert.match(
    login.stdout,
    /^Signed in to Fonte\nYou're ready to use Fonte\./u,
  );
  assert.doesNotMatch(login.stdout, /token|OAuth|client[_ ]ID/iu);

  const loginJson = await runProgram(["auth", "login", "--json"], {
    ...base,
    auth: { session: authDependencies({ loginCheck: "token_issued" }) },
  });
  const verboseLoginJson = await runProgram(
    ["auth", "login", "--json", "--verbose"],
    {
      ...base,
      auth: { session: authDependencies({ loginCheck: "token_issued" }) },
    },
  );
  assert.equal(verboseLoginJson.stdout, loginJson.stdout);

  const logout = await runProgram(["auth", "logout"], {
    ...base,
    auth: { session: authDependencies() },
  });
  assert.equal(logout.stdout, "Signed out of Fonte.\n");

  const logoutJson = await runProgram(["auth", "logout", "--json"], {
    ...base,
    auth: { session: authDependencies() },
  });
  const verboseLogoutJson = await runProgram(
    ["auth", "logout", "--json", "--verbose"],
    { ...base, auth: { session: authDependencies() } },
  );
  assert.equal(verboseLogoutJson.stdout, logoutJson.stdout);

  const alreadySignedOut = await runProgram(["auth", "logout"], {
    ...base,
    auth: {
      session: authDependencies({
        logout: { local: "already_signed_out", remote: "unsupported" },
      }),
    },
  });
  assert.equal(alreadySignedOut.stdout, "You're already signed out.\n");

  const busy = await runProgram(["auth", "status"], {
    ...base,
    auth: {
      session: authDependencies({
        status: { state: "login_pending", serverCheck: "not_checked" },
      }),
    },
  });
  assert.equal(
    busy.stdout,
    "Another Fonte sign-in is already in progress.\nFinish it in your browser, or try again in a moment.\n",
  );
  assert.equal(
    humanLoginRecovery("authorization_interaction_required"),
    "Fonte needs you to sign in.\n\nRun:\n  fonte auth login\n",
  );
  assert.equal(
    renderBlockedOperator({
      command: "broadcast_preflight",
      outcome: "blocked",
      reason: "oauth_client_route_denied",
      result: null,
      core_effect: "none",
    }),
    "Fonte couldn't use your current sign-in for this action.\n\nTry:\n  fonte auth login\n",
  );
  assert.match(
    renderBlockedOperator(
      {
        command: "broadcast_preflight",
        outcome: "blocked",
        reason: "oauth_client_route_denied",
        result: null,
        core_effect: "none",
      },
      true,
    ),
    /Diagnostic reason: oauth_client_route_denied/u,
  );
});

test("status is read-only, human-first, and returns the shared readiness schema", async () => {
  const fixture = readinessFixture();
  await runFonteSetup(fixture.dependencies);
  fixture.resetEffects();

  const status = await runProgram(["status"], {
    ...base,
    setup: fixture.dependencies,
  });
  assert.equal(status.exitCode, 0);
  assert.equal(
    status.stdout,
    "Fonte is ready\n\nWorkspace: Demo Workspace\nSigned in: Yes\n",
  );
  assert.doesNotMatch(
    status.stdout,
    /schema_version|readiness|fonte-mcp|Sending: Ready/u,
  );
  assert.deepEqual(fixture.effects, {
    configWrites: 0,
    workspaceWrites: 0,
  });

  const statusJson = await runProgram(["status", "--json"], {
    ...base,
    setup: fixture.dependencies,
  });
  const verboseStatusJson = await runProgram(
    ["status", "--json", "--verbose"],
    { ...base, setup: fixture.dependencies },
  );
  const setupJson = await runProgram(["setup", "--json"], {
    ...base,
    setup: fixture.dependencies,
  });
  assert.equal(statusJson.stdout, setupJson.stdout);
  assert.equal(verboseStatusJson.stdout, statusJson.stdout);
  const verboseSetupJson = await runProgram(["setup", "--json", "--verbose"], {
    ...base,
    setup: fixture.dependencies,
  });
  assert.equal(verboseSetupJson.stdout, setupJson.stdout);
  assert.equal(JSON.parse(statusJson.stdout).schema, "fonte.readiness.v1");
  assert.deepEqual(fixture.effects, {
    configWrites: 0,
    workspaceWrites: 0,
  });

  const setupHuman = await runProgram(["setup"], {
    ...base,
    setup: fixture.dependencies,
  });
  assert.match(setupHuman.stdout, /^Fonte setup is complete/u);
});

test("status gives a human login action and setup accepts the suggested command", async () => {
  const fixture = readinessFixture({
    status: { state: "absent", serverCheck: "not_checked" },
  });
  await runFonteSetup(fixture.dependencies);
  fixture.resetEffects();
  const status = await runProgram(["status"], {
    ...base,
    setup: fixture.dependencies,
  });
  assert.equal(status.exitCode, 3);
  assert.match(status.stdout, /Fonte needs attention/u);
  assert.match(status.stdout, /Signed in: No/u);
  assert.match(status.stdout, /Run:\n  fonte auth login/u);
  assert.doesNotMatch(
    status.stdout,
    /login_required|sign_in_required|Reason code/u,
  );
  assert.deepEqual(parseArguments(["setup"]), {
    command: "setup",
    apply: false,
    json: false,
  });
});

test("verbose is presentation-only for auth execution and machine commands", async () => {
  assert.deepEqual(parseArguments(["auth", "status", "--verbose"]), {
    command: "auth-session",
    authAction: "status",
    apply: false,
    json: false,
    switchAccount: false,
    verbose: true,
  });
  assert.equal(
    parseArguments(["auth", "exec", "--verbose", "--", "node", "--version"])
      .verbose,
    true,
  );
  assert.equal(parseArguments(["status", "--verbose"]).verbose, true);
  assert.equal(parseArguments(["setup", "--verbose"]).verbose, true);
  assert.equal(
    parseArguments(["bridge", "status", "--json", "--verbose"]).json,
    true,
  );
  const operatorJson = await runProgram(["bridge", "status", "--json"], {
    ...base,
    operator: {},
  });
  const verboseOperatorJson = await runProgram(
    ["bridge", "status", "--json", "--verbose"],
    { ...base, operator: {} },
  );
  assert.equal(verboseOperatorJson.stdout, operatorJson.stdout);

  const failedExec = await runProgram(
    ["auth", "exec", "--verbose", "--", "node"],
    {
      ...base,
      authExec: {
        configUrl: "http://127.0.0.1/.well-known/fonte-cli.json",
        fetch: async () =>
          new Response(JSON.stringify(hostedConfig), {
            headers: { "content-type": "application/json" },
          }),
        authorize: async () => {
          throw new HostedTestBlockedError(
            "authorization_interaction_required",
          );
        },
        spawn: async () => assert.fail("failed authorization must not spawn"),
      },
    },
  );
  assert.match(failedExec.stderr, /Fonte needs you to sign in/u);
  assert.match(
    failedExec.stderr,
    /Diagnostic reason: authorization_interaction_required/u,
  );
});

function authDependencies({
  status = readySession,
  loginCheck = "not_checked",
  loginError,
  logout = { local: "cleared", remote: "unsupported" },
  storage = { backend: "user_private_file", status: "available" },
} = {}) {
  return {
    status: async () => status,
    login: async () => {
      if (loginError) throw new HostedTestBlockedError(loginError);
      return { status: readySession, serverCheck: loginCheck };
    },
    logout: async () => logout,
    storageInfo: async () => storage,
  };
}

function readinessFixture({
  status = readySession,
  workspaces = [{ slug: "demo-workspace", name: "Demo Workspace" }],
} = {}) {
  let config = '[mcp_servers.other]\ncommand = "other-host"\n';
  let selectedWorkspace = null;
  const effects = { configWrites: 0, workspaceWrites: 0 };
  const dependencies = {
    codexConfig: {
      readText: async () => config,
      writeText: async (expected, next) => {
        assert.equal(config, expected);
        config = next;
        effects.configWrites += 1;
      },
    },
    locateInstalledHost: async () => ({
      command: "/fixture/node",
      args: ["/fixture/dist/mcp-main.js"],
    }),
    inspectInstalledHost: async () => ({
      initialized: true,
      tools: [...REQUIRED_PRODUCT_TOOLS],
    }),
    readSession: async () => ({ status, storageAvailable: true }),
    listWorkspaces: async () => workspaces,
    readSelectedWorkspace: async () => selectedWorkspace,
    writeSelectedWorkspace: async (slug) => {
      selectedWorkspace = slug;
      effects.workspaceWrites += 1;
    },
  };
  return {
    dependencies,
    effects,
    resetEffects() {
      effects.configWrites = 0;
      effects.workspaceWrites = 0;
    },
  };
}
