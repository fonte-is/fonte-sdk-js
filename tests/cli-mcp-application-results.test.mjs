import assert from "node:assert/strict";
import test from "node:test";
import {
  CoreOperatorError,
  createCoreRequester,
} from "../packages/cli/dist/operator-core-request.js";
import { handleCoreMcpRequest } from "../packages/cli/dist/mcp-core-handler.js";

const workspace = "northstar";
const operation_id = "77777777-7777-4777-8777-777777777777";
const draft_id = "99999999-9999-4999-8999-999999999999";
const configuration = {
  schema: "fonte.application.source.v2",
  origin: "https://app.example.test",
  triggers: [{ key: "report_saved", label: "Report saved" }],
  activityGranted: true,
  identityLinkGranted: true,
  policyVersion: "fonte_measurement.v1",
};
async function call(name, args, requester) {
  const response = await handleCoreMcpRequest(
    new Request("https://app.example.test/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    requester,
    "https://api.example.test",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  return await response.json();
}

test("customer Source setup separates key-issuing connection from settings and preserves explicit grants", async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    return { source: { revision: 1 }, serverKey: null };
  };
  const input = {
    workspace,
    operation_id,
    expected_revision: 0,
    configuration,
  };
  await call("fonte_connect_application", input, request);
  await call(
    "fonte_save_application_settings",
    {
      ...input,
      expected_revision: 1,
      configuration: { ...configuration, activityGranted: false },
    },
    request,
  );
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(calls[0].options.body, {
    operationId: operation_id,
    expectedRevision: 0,
    configuration,
  });
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[1].options.body.configuration.activityGranted, false);
  assert.equal(calls[1].options.body.expectedRevision, 1);
  assert.ok(
    calls.every(
      (item) =>
        item.path ===
        `/v1/workspaces/${workspace}/application?environment=production`,
    ),
  );
  assert.ok(
    calls.every((item) => item.options.lostResponseEffect === "unknown"),
  );
});

test("unsupported setup and extra configuration cannot reach Core", async () => {
  let effects = 0;
  const request = async () => {
    effects++;
    return {};
  };
  const input = {
    workspace,
    operation_id,
    expected_revision: 0,
    configuration,
  };
  for (const value of [
    { ...input, environment: "test" },
    { ...input, expected_revision: Number.MAX_SAFE_INTEGER + 1 },
    {
      ...input,
      configuration: { ...configuration, identityLinkGranted: undefined },
    },
    {
      ...input,
      configuration: {
        ...configuration,
        origin: "https://app.example.test/callback",
      },
    },
    {
      ...input,
      configuration: {
        ...configuration,
        origin: "https://user:password@app.example.test",
      },
    },
    {
      ...input,
      configuration: {
        ...configuration,
        triggers: [...configuration.triggers, ...configuration.triggers],
      },
    },
    {
      ...input,
      configuration: {
        ...configuration,
        externalSettings: { token: "synthetic-public-token" },
      },
    },
  ]) {
    const response = await call("fonte_connect_application", value, request);
    assert.ok(response.error || response.result.isError);
  }
  assert.equal(effects, 0);
  await call("fonte_connect_application", input, request);
  assert.equal(effects, 1);
});

test("denied setup and unknown key-issuing effects are not retried or treated as a connection", async () => {
  for (const [status, effect, outcome] of [
    [403, "none", "denied"],
    [409, "none", "conflict"],
    [null, "unknown", "ambiguous"],
  ]) {
    let attempts = 0;
    const response = await call(
      "fonte_connect_application",
      { workspace, operation_id, expected_revision: 0, configuration },
      async () => {
        attempts++;
        throw new CoreOperatorError("application_setup_failed", status, effect);
      },
    );
    assert.equal(attempts, 1);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.outcome, outcome);
    assert.equal(response.result.structuredContent.core_effect, effect);
    assert.equal("receipt" in response.result.structuredContent, false);
  }
});

test("an already-sent definition conflict cannot become a new definition or a Send", async () => {
  let calls = 0;
  const response = await call(
    "fonte_bind_broadcast_results",
    { workspace, draft_id, expected_source_revision: 3 },
    async (path, options) => {
      calls++;
      assert.equal(
        path,
        `/v1/workspaces/${workspace}/broadcast-drafts/${draft_id}/results-definition?environment=production`,
      );
      assert.deepEqual(options.body, { expectedSourceRevision: 3 });
      assert.equal(options.method, "PUT");
      throw new CoreOperatorError("outcome_definition_frozen", 409, "none");
    },
  );
  assert.equal(calls, 1);
  assert.equal(response.result.structuredContent.outcome, "conflict");
});

test("the unbound definition alone accepts an explicit JSON null read receipt", async () => {
  const fetched = [];
  const request = createCoreRequester({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic-bearer",
    fetch: async (url, options) => {
      fetched.push({ url, method: options.method });
      return new Response("null", {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const unbound = await call(
    "fonte_read_broadcast_results_definition",
    { workspace, draft_id },
    request,
  );
  assert.equal(unbound.result.structuredContent.outcome, "completed");
  assert.equal(unbound.result.structuredContent.receipt, null);
  assert.equal(unbound.result.isError, undefined);
  const malformed = await call(
    "fonte_read_application",
    { workspace },
    request,
  );
  assert.equal(malformed.result.isError, true);
  assert.equal(malformed.result.structuredContent.core_effect, "none");
  const mutation = await call(
    "fonte_bind_broadcast_results",
    { workspace, draft_id, expected_source_revision: 1 },
    request,
  );
  assert.equal(mutation.result.isError, true);
  assert.equal(mutation.result.structuredContent.core_effect, "unknown");
  assert.deepEqual(
    fetched.map((item) => item.method),
    ["GET", "GET", "PUT"],
  );
  for (const raw of ["", "not-json"]) {
    const invalid = createCoreRequester({
      coreApiBaseUrl: "https://api.example.test",
      bearer: "synthetic-bearer",
      fetch: async () => new Response(raw),
    });
    const response = await call(
      "fonte_read_broadcast_results_definition",
      { workspace, draft_id },
      invalid,
    );
    assert.equal(response.result.isError, true);
  }
});

test("Results keep partial coverage and opaque pagination; a changed revision remains a conflict", async () => {
  const cursor = "opaque_scope_revision_123";
  const expected = {
    status: "available",
    revision: 2,
    report: {
      returned: {
        status: "partial",
        observedCount: 1,
        coverage: { status: "stale", gaps: [{ reason: "source_unavailable" }] },
      },
    },
    rows: [],
    nextCursor: cursor,
  };
  const response = await call(
    "fonte_read_broadcast_outcomes",
    { workspace, draft_id },
    async (path) => {
      assert.equal(
        path,
        `/v1/workspaces/${workspace}/broadcast-drafts/${draft_id}/results?environment=production`,
      );
      return expected;
    },
  );
  assert.deepEqual(response.result.structuredContent.receipt, expected);
  const conflict = await call(
    "fonte_read_broadcast_outcomes",
    { workspace, draft_id, cursor },
    async (path) => {
      assert.ok(path.endsWith(`&cursor=${cursor}`));
      throw new CoreOperatorError(
        "outcome_cursor_revision_conflict",
        409,
        "none",
      );
    },
  );
  assert.equal(conflict.result.structuredContent.outcome, "conflict");
  assert.equal("receipt" in conflict.result.structuredContent, false);
});

test("concurrent application reads preserve their authenticated workspace requester", async () => {
  const request = (selected) => async (path) => {
    assert.equal(
      path,
      `/v1/workspaces/${selected}/application?environment=production`,
    );
    return { workspace: selected, source: null };
  };
  const [a, b] = await Promise.all([
    call("fonte_read_application", { workspace }, request(workspace)),
    call(
      "fonte_read_application",
      { workspace: "southstar" },
      request("southstar"),
    ),
  ]);
  assert.equal(a.result.structuredContent.receipt.workspace, workspace);
  assert.equal(b.result.structuredContent.receipt.workspace, "southstar");
});

test("disconnect traverses the actual Core requester as DELETE with unknown effect on response loss", async () => {
  let attempts = 0;
  const request = createCoreRequester({
    coreApiBaseUrl: "https://api.example.test",
    bearer: "synthetic-bearer",
    fetch: async (url, options) => {
      attempts++;
      assert.equal(
        url,
        `https://api.example.test/v1/workspaces/${workspace}/application?environment=production`,
      );
      assert.equal(options.method, "DELETE");
      assert.equal(options.body, "{}");
      assert.equal(options.redirect, "error");
      throw new TypeError("synthetic lost response");
    },
  });
  const response = await call(
    "fonte_disconnect_application",
    { workspace },
    request,
  );
  assert.equal(attempts, 1);
  assert.equal(response.result.structuredContent.outcome, "ambiguous");
  assert.equal(response.result.structuredContent.core_effect, "unknown");
});
