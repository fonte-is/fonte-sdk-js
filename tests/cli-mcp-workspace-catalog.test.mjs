import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_FONTE_ALLOWLIST,
  createDurableFonteMcpSession,
} from "../packages/cli/dist/mcp-sequence-server.js";
import { HOSTED_CONFIG_URL } from "../packages/cli/dist/hosted-config.js";
import { createWorkspaceCatalogClient } from "../packages/cli/dist/operator-workspace-catalog-client.js";
import { createWorkspaceInvitationClient } from "../packages/cli/dist/operator-workspace-invitation-client.js";

test("workspace discovery reads the accessible catalog without exposing internal identities", async () => {
  const paths = [];
  const client = createWorkspaceCatalogClient(async (path) => {
    paths.push(path);
    return {
      workspaces: [
        {
          workspaceId: "internal-workspace-id",
          tenantId: "internal-tenant-id",
          accountId: "internal-account-id",
          slug: "fonte",
          workspaceSlug: "fonte",
          workspaceCode: "fonte",
          displayName: "Fonte",
          role: "owner",
          availableEnvironments: ["production"],
          localBootstrapIdentity: null,
        },
      ],
    };
  });

  assert.deepEqual(await client.listWorkspaces(), [
    {
      slug: "fonte",
      name: "Fonte",
      role: "owner",
      available_environments: ["production"],
    },
  ]);
  assert.deepEqual(paths, ["/v1/workspaces"]);
  assert.ok(MCP_FONTE_ALLOWLIST.tools.includes("fonte_list_workspaces"));
});

test("workspace discovery uses the same durable auth provider", async () => {
  let authorizations = 0;
  const session = createDurableFonteMcpSession({
    configUrl: HOSTED_CONFIG_URL,
    fetch: async (input) => {
      if (String(input) === HOSTED_CONFIG_URL) {
        return new Response(
          JSON.stringify({
            schema: "fonte.cli.hosted_config.v1",
            authorizationServer: "https://identity.example.test/auth/v1",
            clientId: "fonte-cli-client-v0",
            coreApiBaseUrl: "https://api.example.test",
            redirectUri: "http://127.0.0.1:49671/callback",
            scopes: ["email"],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(String(input), "https://api.example.test/v1/workspaces");
      return new Response(JSON.stringify({ workspaces: [] }), {
        headers: { "content-type": "application/json" },
      });
    },
    authorize: async () => {
      authorizations += 1;
      return "synthetic-workspace-bearer";
    },
  });

  const workspaces = await (await session.workspaceCatalog()).listWorkspaces();
  assert.deepEqual(workspaces, []);
  assert.equal(authorizations, 1);
});

test("workspace discovery validates billing access without inventing an operational role", async () => {
  const entry = {
    workspaceId: "synthetic-workspace",
    tenantId: "synthetic-workspace",
    accountId: "synthetic-account",
    slug: "northstar",
    workspaceSlug: "northstar",
    workspaceCode: "NORTHSTAR",
    displayName: "Northstar",
    role: "owner",
    billingAccess: "manage",
    availableEnvironments: ["production"],
  };
  let current = entry;
  const client = createWorkspaceCatalogClient(async () => ({
    workspaces: [current],
  }));
  assert.deepEqual(await client.listWorkspaces(), [
    {
      slug: "northstar",
      name: "Northstar",
      role: "owner",
      billing_access: "manage",
      available_environments: ["production"],
    },
  ]);
  current = { ...entry, role: null, billingAccess: "view" };
  assert.equal((await client.listWorkspaces())[0].role, null);
  for (const patch of [
    { billingAccess: "owner" },
    { billingAccess: null },
    { role: null, billingAccess: "none" },
    { unrelatedAuthority: true },
  ]) {
    current = { ...entry, ...patch };
    await assert.rejects(
      client.listWorkspaces(),
      (error) => error.reason === "core_operator_receipt_invalid",
    );
  }
});

test("metadata workspace contexts reuse catalog validation for billing access and bootstrap metadata", async () => {
  const entry = {
    workspaceId: "synthetic-workspace",
    tenantId: "synthetic-workspace",
    accountId: "synthetic-account",
    slug: "northstar",
    workspaceSlug: "northstar",
    workspaceCode: "NORTHSTAR",
    displayName: "Northstar",
    role: "owner",
    billingAccess: "manage",
    availableEnvironments: ["production"],
    localBootstrapIdentity: { kind: "synthetic" },
  };
  let current = entry;
  const client = createWorkspaceInvitationClient(async () => ({
    workspaces: [current],
  }));
  assert.equal(
    (await client.listWorkspaceContexts())[0].billing_access,
    "manage",
  );
  current = { ...entry, role: null, billingAccess: "view" };
  assert.equal((await client.listWorkspaceContexts())[0].role, null);
  for (const patch of [
    { billingAccess: "owner" },
    { role: null, billingAccess: "none" },
    { tenantId: "foreign" },
    { unrelatedAuthority: true },
  ]) {
    current = { ...entry, ...patch };
    await assert.rejects(
      client.listWorkspaceContexts(),
      (error) => error.reason === "core_operator_receipt_invalid",
    );
  }
});
