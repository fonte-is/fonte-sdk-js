import assert from "node:assert/strict";
import test from "node:test";

import {
  readFonteReadiness,
  REQUIRED_PRODUCT_TOOLS,
} from "../packages/cli/dist/mcp-readiness.js";

const workspace = { slug: "demo-store", name: "Demo Store" };

function reader(overrides = {}) {
  return {
    inspectHost: async () => ({
      initialized: true,
      tools: [...REQUIRED_PRODUCT_TOOLS],
    }),
    readSession: async () => ({
      status: {
        state: "ready",
        serverCheck: "not_checked",
        subject: "private-subject",
      },
      storageAvailable: true,
    }),
    listWorkspaces: async () => [workspace],
    readSelectedWorkspace: async () => workspace.slug,
    ...overrides,
  };
}

test("signed-in selected workspace projects one ready state", async () => {
  assert.equal(REQUIRED_PRODUCT_TOOLS.length, 27);
  const result = await readFonteReadiness(reader());

  assert.equal(result.state, "ready");
  assert.equal(result.reason, null);
  assert.equal(result.next_action, null);
  assert.deepEqual(result.selected_workspace, workspace);
  assert.equal(result.authentication, "ready");
});

test("genuinely signed-out session returns login_required", async () => {
  const result = await readFonteReadiness(
    reader({
      readSession: async () => ({
        status: { state: "signed_out", serverCheck: "not_checked" },
        storageAvailable: true,
      }),
      listWorkspaces: async () => {
        throw new Error("must not query workspaces while signed out");
      },
    }),
  );

  assert.equal(result.state, "login_required");
  assert.equal(result.reason, "sign_in_required");
  assert.equal(
    result.next_action,
    "Run fonte auth login once, then run fonte setup again.",
  );
});

test("an expired pending marker is never reported as login_busy", async () => {
  const result = await readFonteReadiness(
    reader({
      readSession: async () => ({
        status: { state: "login_pending_expired", serverCheck: "not_checked" },
        storageAvailable: true,
      }),
    }),
  );

  assert.equal(result.state, "login_required");
  assert.equal(result.reason, "sign_in_required");
  assert.doesNotMatch(JSON.stringify(result), /login_busy|login_pending/);
});

test("multiple workspaces without an explicit saved selection require a choice", async () => {
  const choices = [workspace, { slug: "northstar", name: "Northstar" }];
  let writes = 0;
  const result = await readFonteReadiness(
    reader({
      listWorkspaces: async () => choices,
      readSelectedWorkspace: async () => null,
      writeSelectedWorkspace: async () => {
        writes += 1;
      },
    }),
  );

  assert.equal(result.state, "workspace_required");
  assert.equal(result.reason, "workspace_selection_required");
  assert.deepEqual(result.workspace_choices, choices);
  assert.equal(result.selected_workspace, null);
  assert.equal(writes, 0);
});

test("setup can persist the sole workspace as the private local default", async () => {
  let selected = null;
  const result = await readFonteReadiness(
    reader({
      readSelectedWorkspace: async () => selected,
      writeSelectedWorkspace: async (slug) => {
        selected = slug;
      },
    }),
    { selectUnambiguousWorkspace: true },
  );

  assert.equal(selected, workspace.slug);
  assert.equal(result.state, "ready");
  assert.deepEqual(result.selected_workspace, workspace);
});

test("missing required product tools requests one exact repair action", async () => {
  const result = await readFonteReadiness(
    reader({
      inspectHost: async () => ({
        initialized: true,
        tools: REQUIRED_PRODUCT_TOOLS.filter(
          (name) => name !== "fonte_list_workspaces",
        ),
      }),
      readSession: async () => {
        throw new Error("auth is not inspected after catalog failure");
      },
    }),
  );

  assert.equal(result.state, "repair_required");
  assert.equal(result.reason, "required_tools_missing");
  assert.equal(result.authentication, "not_checked");
  assert.deepEqual(result.missing_tools, ["fonte_list_workspaces"]);
  assert.equal(
    result.next_action,
    "Update Fonte CLI to a build with the required tools, then run fonte setup again.",
  );
});

test("workspace choices are bounded", async () => {
  const choices = Array.from({ length: 25 }, (_, index) => ({
    slug: `demo-${index}`,
    name: `Demo ${index}`,
  }));
  const result = await readFonteReadiness(
    reader({
      listWorkspaces: async () => choices,
      readSelectedWorkspace: async () => null,
    }),
  );

  assert.equal(result.workspace_choices.length, 20);
  assert.equal(result.more_workspace_choices, true);
});

test("readiness does not expose auth subjects or credential-shaped values", async () => {
  const result = await readFonteReadiness(
    reader({
      readSession: async () => ({
        status: {
          state: "ready",
          serverCheck: "not_checked",
          subject: "synthetic-private-subject",
          loginId: "synthetic-login-id",
        },
        storageAvailable: true,
      }),
    }),
  );
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(
    serialized,
    /synthetic-private-subject|synthetic-login-id|token|secret|refresh/,
  );
});
