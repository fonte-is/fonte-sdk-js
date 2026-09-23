import assert from "node:assert/strict";
import test from "node:test";

import { runFonteSetup } from "../packages/cli/dist/local-setup.js";
import { REQUIRED_PRODUCT_TOOLS } from "../packages/cli/dist/mcp-readiness.js";

const host = {
  command: "/runtime/node",
  args: ["/package/dist/mcp-main.js"],
};
const workspace = { slug: "demo-store", name: "Demo Store" };

function fixture(overrides = {}) {
  let config = '[mcp_servers.other]\ncommand = "other-host"\n';
  let selected = null;
  const effects = {
    configWrites: 0,
    workspaceWrites: 0,
    sessionReads: 0,
    workspaceReads: 0,
  };
  const dependencies = {
    codexConfig: {
      readText: async () => config,
      writeText: async (expected, next) => {
        assert.equal(config, expected);
        config = next;
        effects.configWrites += 1;
      },
    },
    locateInstalledHost: async () => host,
    inspectInstalledHost: async () => ({
      initialized: true,
      tools: [...REQUIRED_PRODUCT_TOOLS],
    }),
    readSession: async () => {
      effects.sessionReads += 1;
      return {
        status: { state: "ready", serverCheck: "not_checked" },
        storageAvailable: true,
      };
    },
    listWorkspaces: async () => {
      effects.workspaceReads += 1;
      return [workspace];
    },
    readSelectedWorkspace: async () => selected,
    writeSelectedWorkspace: async (slug) => {
      selected = slug;
      effects.workspaceWrites += 1;
    },
    ...overrides,
  };
  return {
    dependencies,
    effects,
    get config() {
      return config;
    },
    get selected() {
      return selected;
    },
    setConfig(value) {
      config = value;
    },
    setSelected(value) {
      selected = value;
    },
  };
}

test("setup configures only Fonte, then returns login_required without probing workspaces", async () => {
  const state = fixture({
    readSession: async () => {
      state.effects.sessionReads += 1;
      return {
        status: { state: "signed_out", serverCheck: "not_checked" },
        storageAvailable: true,
      };
    },
  });
  const result = await runFonteSetup(state.dependencies);

  assert.equal(result.state, "login_required");
  assert.equal(result.reason, "sign_in_required");
  assert.equal(state.effects.configWrites, 1);
  assert.equal(state.effects.sessionReads, 1);
  assert.equal(state.effects.workspaceReads, 0);
  assert.match(state.config, /\[mcp_servers\.other\]/);
  assert.match(state.config, /\[mcp_servers\.fonte\]/);
});

test("setup saves the sole workspace as local context and returns ready", async () => {
  const state = fixture();
  const result = await runFonteSetup(state.dependencies);

  assert.equal(result.state, "ready");
  assert.equal(state.selected, workspace.slug);
  assert.equal(state.effects.workspaceWrites, 1);
  assert.equal(state.effects.configWrites, 1);
});

test("setup never chooses the first of multiple workspaces", async () => {
  const state = fixture({
    listWorkspaces: async () => [
      workspace,
      { slug: "northstar", name: "Northstar" },
    ],
  });
  const result = await runFonteSetup(state.dependencies);

  assert.equal(result.state, "workspace_required");
  assert.equal(result.selected_workspace, null);
  assert.equal(result.workspace_choices.length, 2);
  assert.equal(state.effects.workspaceWrites, 0);
});

test("setup accepts an explicit listed workspace selection", async () => {
  const state = fixture({
    listWorkspaces: async () => [
      workspace,
      { slug: "northstar", name: "Northstar" },
    ],
  });
  const result = await runFonteSetup(state.dependencies, {
    workspace: "northstar",
  });

  assert.equal(result.state, "ready");
  assert.equal(state.selected, "northstar");
  assert.equal(result.selected_workspace.slug, "northstar");
});

test("setup leaves an already-correct config unchanged", async () => {
  const state = fixture();
  const first = await runFonteSetup(state.dependencies);
  assert.equal(first.state, "ready");
  const before = state.config;
  state.setSelected(workspace.slug);
  state.effects.configWrites = 0;

  const second = await runFonteSetup(state.dependencies);

  assert.equal(second.state, "ready");
  assert.equal(state.config, before);
  assert.equal(state.effects.configWrites, 0);
});

test("setup reports repair_required when the installed catalog is incomplete", async () => {
  const state = fixture({
    inspectInstalledHost: async () => ({
      initialized: true,
      tools: REQUIRED_PRODUCT_TOOLS.filter(
        (name) => name !== "fonte_read_broadcast_draft",
      ),
    }),
  });
  const result = await runFonteSetup(state.dependencies);

  assert.equal(result.state, "repair_required");
  assert.deepEqual(result.missing_tools, ["fonte_read_broadcast_draft"]);
  assert.equal(state.effects.sessionReads, 0);
  assert.equal(state.effects.workspaceReads, 0);
});

test("setup maps local Codex config failure to one safe action", async () => {
  const state = fixture({
    codexConfig: {
      readText: async () => {
        throw new Error("private file path details");
      },
      writeText: async () => {
        throw new Error("must not write after read failure");
      },
    },
  });
  const result = await runFonteSetup(state.dependencies);

  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "codex_configuration_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private file path details/);
  assert.match(result.next_action, /^Run fonte setup again\./);
});
