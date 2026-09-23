import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_FONTE_ALLOWLIST,
  createDurableFonteMcpSession,
} from "../packages/cli/dist/mcp-sequence-server.js";
import { HOSTED_CONFIG_URL } from "../packages/cli/dist/hosted-config.js";
import { createWorkspaceCatalogClient } from "../packages/cli/dist/operator-workspace-catalog-client.js";

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
