import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";

import { createClientAuthRuntime } from "../packages/cli/dist/client-auth-runtime.js";
import { HostedTestBlockedError } from "../packages/cli/dist/hosted-errors.js";
import { createDurableSequenceMcpSession } from "../packages/cli/dist/mcp-sequence-server.js";
import { createSequenceToolHandlers } from "../packages/cli/dist/mcp-sequence-tools.js";
import {
  definition,
  configUrl,
  hostedConfig,
  json,
  sequenceId,
  sequenceRoute,
  workspace,
} from "./cli-sequence-authoring-support.mjs";

const scope = { workspace, environment: "sandbox" };

test("an injected CLI login survives MCP restart and fences logout and account switch", async () => {
  let record = null;
  let renewals = 0;
  let browserCalls = 0;
  let uuid = 0;
  const store = {
    read: async () => (record === null ? null : structuredClone(record)),
    replace: async (next) => {
      record = structuredClone(next);
    },
  };
  const cli = createClientAuthRuntime({
    fetch: async () => json(hostedConfig()),
    configUrl,
    store,
    oauth: {
      prepareExplicitLogin: async () => {
        browserCalls += 1;
        return {
          complete: async (commit) => {
            const grant = loginGrant("interactive");
            await commit(grant);
            return grant;
          },
        };
      },
      renew: async () => assert.fail("the signing-in process reuses memory"),
    },
    withLock: async (operation) => operation(),
    now: () => 1_000_000,
    randomUUID: () =>
      `10000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    noninteractiveValue: () => undefined,
  });
  await cli.login(false);

  const runtime = mcpRuntime(store, () => {
    renewals += 1;
    return `mcp-${renewals}`;
  });
  const session = durableSession(runtime);
  assert.equal(
    (await createSequenceToolHandlers(session).list(scope)).outcome,
    "completed",
  );

  const restarted = mcpRuntime(store, () => {
    renewals += 1;
    return `restart-${renewals}`;
  });
  assert.equal(
    (await createSequenceToolHandlers(durableSession(restarted)).list(scope))
      .outcome,
    "completed",
  );
  assert.equal(browserCalls, 1);
  assert.equal(renewals, 2);

  await cli.logout();
  assert.equal(
    (await createSequenceToolHandlers(session).list(scope)).reason,
    "login_required",
  );
  await cli.login(true);
  assert.equal(
    (await createSequenceToolHandlers(session).list(scope)).reason,
    "login_changed",
  );
  assert.equal(browserCalls, 2);
});

test("each MCP tool boundary rereads custody and refuses a surviving stale session", async () => {
  let configurationReads = 0;
  let authorizations = 0;
  let coreRequests = 0;
  let localState = "ready";
  const session = createDurableSequenceMcpSession({
    configUrl,
    fetch: async (input) => {
      if (String(input) === configUrl) {
        configurationReads += 1;
        return json(hostedConfig());
      }
      coreRequests += 1;
      return json({ tenantId: "tenant_demo", environment: "sandbox", rows: [] });
    },
    authorize: async () => {
      authorizations += 1;
      if (localState !== "ready") throw new HostedTestBlockedError(localState);
      return "synthetic-current-bearer";
    },
  });
  const handlers = createSequenceToolHandlers(session);

  assert.equal((await handlers.list(scope)).outcome, "completed");
  localState = "login_changed";
  assert.deepEqual(await handlers.list(scope), {
    outcome: "unavailable",
    reason: "login_changed",
    status_code: null,
    core_effect: "none",
    sequences: null,
  });
  localState = "login_required";
  assert.equal((await handlers.list(scope)).reason, "login_required");
  localState = "secure_storage_interaction_required";
  assert.equal(
    (await handlers.list(scope)).reason,
    "secure_storage_interaction_required",
  );
  localState = "login_refresh_uncertain";
  assert.equal((await handlers.list(scope)).reason, "login_refresh_uncertain");

  assert.equal(configurationReads, 5);
  assert.equal(authorizations, 5);
  assert.equal(coreRequests, 1);
});

test("only exact pre-effect human-auth rejection refreshes and retries unchanged once", async () => {
  const coreCalls = [];
  const renewals = [];
  let coreAttempt = 0;
  const session = createDurableSequenceMcpSession({
    configUrl,
    fetch: async (input, init = {}) => {
      if (String(input) === configUrl) return json(hostedConfig());
      coreAttempt += 1;
      const url = new URL(String(input));
      coreCalls.push({
        method: init.method,
        path: `${url.pathname}${url.search}`,
        body: init.body,
        authorization: init.headers.authorization,
        idempotencyKey: init.headers["idempotency-key"],
      });
      if (coreAttempt === 1)
        return json({ error: "human_auth_invalid" }, 401);
      return sequenceRoute({
        method: init.method,
        path: `${url.pathname}${url.search}`,
        body: JSON.parse(init.body),
        headers: init.headers,
      });
    },
    authorize: async () => "synthetic-old-bearer",
    renewAuthorization: async (hosted, signal, force) => {
      renewals.push({ hosted, signal, force });
      return "synthetic-new-bearer";
    },
  });
  const result = await createSequenceToolHandlers(session).create({
    ...scope,
    sequence_id: sequenceId,
    operation_key: "create-welcome",
    definition,
  });

  assert.equal(result.outcome, "completed");
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].force, true);
  assert.deepEqual(
    coreCalls.map(({ authorization, ...call }) => call),
    [
      {
        method: "POST",
        path: `/v1/workspaces/${workspace}/sequences?environment=sandbox`,
        body: coreCalls[0].body,
        idempotencyKey: "create-welcome",
      },
      {
        method: "POST",
        path: `/v1/workspaces/${workspace}/sequences?environment=sandbox`,
        body: coreCalls[0].body,
        idempotencyKey: "create-welcome",
      },
    ],
  );
  assert.deepEqual(
    coreCalls.map((call) => call.authorization),
    ["Bearer synthetic-old-bearer", "Bearer synthetic-new-bearer"],
  );

  let repeatedRequests = 0;
  let repeatedRenewals = 0;
  const repeated = createDurableSequenceMcpSession({
    configUrl,
    fetch: async (input) => {
      if (String(input) === configUrl) return json(hostedConfig());
      repeatedRequests += 1;
      return json({ error: "human_auth_invalid" }, 401);
    },
    authorize: async () => "synthetic-old-bearer",
    renewAuthorization: async () => {
      repeatedRenewals += 1;
      return "synthetic-new-bearer";
    },
  });
  const denied = await createSequenceToolHandlers(repeated).read({
    ...scope,
    sequence_id: sequenceId,
  });
  assert.equal(denied.reason, "human_auth_invalid");
  assert.equal(repeatedRequests, 2);
  assert.equal(repeatedRenewals, 1);
});

test("denial, conflict, server failure, and lost mutation response never refresh or replay", async () => {
  const cases = [
    [403, "workspace_access_denied", "denied", "none"],
    [409, "sequence_revision_conflict", "conflict", "none"],
    [500, "core_failure", "ambiguous", "unknown"],
  ];
  for (const [status, reason, outcome, effect] of cases) {
    let requests = 0;
    const session = createDurableSequenceMcpSession({
      configUrl,
      fetch: async (input) => {
        if (String(input) === configUrl) return json(hostedConfig());
        requests += 1;
        return json({ error: reason }, status);
      },
      authorize: async () => "synthetic-bearer",
      renewAuthorization: async () => assert.fail("refresh is not admitted"),
    });
    const result = await createSequenceToolHandlers(session).create({
      ...scope,
      sequence_id: sequenceId,
      operation_key: "create-welcome",
      definition,
    });
    assert.equal(result.outcome, outcome);
    assert.equal(result.core_effect, effect);
    assert.equal(requests, 1);
  }

  let requests = 0;
  const lost = createDurableSequenceMcpSession({
    configUrl,
    fetch: async (input) => {
      if (String(input) === configUrl) return json(hostedConfig());
      requests += 1;
      throw new Error("synthetic lost response");
    },
    authorize: async () => "synthetic-bearer",
    renewAuthorization: async () => assert.fail("refresh is not admitted"),
  });
  const result = await createSequenceToolHandlers(lost).create({
    ...scope,
    sequence_id: sequenceId,
    operation_key: "create-welcome",
    definition,
  });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.core_effect, "unknown");
  assert.equal(requests, 1);
});

test("refresh failure remains typed and does not submit a second product request", async () => {
  let requests = 0;
  const session = createDurableSequenceMcpSession({
    configUrl,
    fetch: async (input) => {
      if (String(input) === configUrl) return json(hostedConfig());
      requests += 1;
      return json({ error: "human_auth_invalid" }, 401);
    },
    authorize: async () => "synthetic-old-bearer",
    renewAuthorization: async () => {
      throw new HostedTestBlockedError("login_refresh_uncertain");
    },
  });
  const result = await createSequenceToolHandlers(session).read({
    ...scope,
    sequence_id: sequenceId,
  });
  assert.deepEqual(result, {
    outcome: "unavailable",
    reason: "login_refresh_uncertain",
    status_code: null,
    core_effect: "none",
    sequence: null,
  });
  assert.equal(requests, 1);
});

test("real stdio initialize and tools/list need no login; tool calls reread injected custody", async (t) => {
  const actual = await startMcp("packages/cli/dist/mcp-main.js");
  t.after(() => actual.close());
  await initialize(actual);
  const listed = await actual.request("tools/list", {});
  assert.equal(listed.result.tools.length, 15);
  assert.equal(actual.stderr(), "");
  assertNoSecret(actual.output());

  const injected = await startMcp("tests/fixtures/cli-mcp-session-stdio.mjs");
  t.after(() => injected.close());
  await initialize(injected);
  const first = await injected.request("tools/call", {
    name: "fonte_list_sequences",
    arguments: scope,
  });
  assert.equal(first.result.structuredContent.outcome, "completed");
  const afterLogout = await injected.request("tools/call", {
    name: "fonte_list_sequences",
    arguments: scope,
  });
  assert.equal(afterLogout.result.structuredContent.reason, "login_required");
  assert.equal(injected.stderr(), "");
  assertNoSecret(injected.output());
});

async function initialize(process) {
  const response = await process.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "fonte-session-test", version: "1.0.0" },
  });
  assert.equal(response.result.serverInfo.name, "fonte");
  assert.match(response.result.instructions, /fonte auth login/);
  assert.match(response.result.instructions, /unlock the credential store/);
  process.notify("notifications/initialized", {});
}

async function startMcp(script) {
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, FONTE_NONINTERACTIVE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  let stdout = "";
  let stderr = "";
  lines.on("line", (line) => {
    stdout += `${line}\n`;
    const message = JSON.parse(line);
    if ("id" in message) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const request = (method, params) => {
    id += 1;
    const requestId = id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for ${method}`)),
        5_000,
      );
      pending.set(requestId, (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });
  };
  return {
    request,
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    output: () => stdout,
    stderr: () => stderr,
    close() {
      lines.close();
      child.kill("SIGTERM");
    },
  };
}

function mcpRuntime(store, accessToken) {
  return createClientAuthRuntime({
    fetch: async () => json(hostedConfig()),
    configUrl,
    store,
    oauth: {
      prepareExplicitLogin: async () =>
        assert.fail("MCP must never prepare browser authorization"),
      renew: async (binding, _refreshToken, expectedSubject, options) => {
        await options.beforeExchange();
        const suffix = accessToken();
        return {
          tag: "success",
          accessToken: `synthetic-${suffix}-bearer`,
          refreshToken: `synthetic-${suffix}-refresh`,
          subject: expectedSubject,
          scopes: [...binding.scopes],
          expiresAt: 2_000_000,
          exchangeSubmitted: true,
        };
      },
    },
    withLock: async (operation) => operation(),
    now: () => 1_000_000,
    noninteractiveValue: () => "1",
  });
}

function durableSession(runtime) {
  return createDurableSequenceMcpSession({
    configUrl,
    fetch: async (input) =>
      String(input) === configUrl
        ? json(hostedConfig())
        : json({
            tenantId: "tenant_demo",
            environment: "sandbox",
            rows: [],
          }),
    authorize: runtime.authorize,
    renewAuthorization: runtime.renewAuthorization,
  });
}

function loginGrant(suffix) {
  return {
    accessToken: `synthetic-${suffix}-bearer`,
    refreshToken: `synthetic-${suffix}-refresh`,
    subject: "synthetic-customer-subject",
    scopes: ["email"],
    expiresAt: 2_000_000,
  };
}

function assertNoSecret(value) {
  assert.equal(value.includes("synthetic-stdio-bearer"), false);
  assert.equal(value.includes("synthetic-current-bearer"), false);
  assert.equal(value.includes("refreshToken"), false);
}
