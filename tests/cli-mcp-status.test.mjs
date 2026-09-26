import assert from "node:assert/strict";
import test from "node:test";

import {
  createFonteStatusToolHandler,
  MCP_FONTE_STATUS_TOOL,
} from "../packages/cli/dist/mcp-status-tools.js";
import { REQUIRED_PRODUCT_TOOLS } from "../packages/cli/dist/mcp-readiness.js";

test("fonte_status is a read-only projection over current local facts", async () => {
  const calls = [];
  let writes = 0;
  const handler = createFonteStatusToolHandler({
    inspectHost: async () => {
      calls.push("host");
      return { initialized: true, tools: [...REQUIRED_PRODUCT_TOOLS] };
    },
    readSession: async () => {
      calls.push("session");
      return {
        status: { state: "ready", serverCheck: "not_checked" },
        storageAvailable: true,
      };
    },
    listWorkspaces: async () => {
      calls.push("workspaces");
      return [{ slug: "demo-store", name: "Demo Store" }];
    },
    readSelectedWorkspace: async () => {
      calls.push("selection");
      return "demo-store";
    },
    writeSelectedWorkspace: async () => {
      writes += 1;
    },
  });

  const result = await handler({});

  assert.equal(MCP_FONTE_STATUS_TOOL, "fonte_status");
  assert.equal(result.state, "ready");
  assert.deepEqual(calls, ["host", "session", "workspaces", "selection"]);
  assert.equal(writes, 0);
});

test("fonte_status rejects arguments rather than accepting hidden commands", async () => {
  const handler = createFonteStatusToolHandler({
    inspectHost: async () => ({
      initialized: true,
      tools: [...REQUIRED_PRODUCT_TOOLS],
    }),
    readSession: async () => ({
      status: { state: "ready", serverCheck: "not_checked" },
      storageAvailable: true,
    }),
    listWorkspaces: async () => [{ slug: "demo-store", name: "Demo Store" }],
    readSelectedWorkspace: async () => "demo-store",
  });

  await assert.rejects(handler({ workspace: "demo-store" }));
});
