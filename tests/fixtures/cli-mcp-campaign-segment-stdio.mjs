import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import {
  createDurableSequenceMcpSession,
  createFonteSequenceMcpServer,
} from "../../packages/cli/dist/mcp-sequence-server.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "11111111-1111-4111-8111-111111111111";
const segmentId = "22222222-2222-4222-8222-222222222222";
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const workspace = {
  workspaceId: tenantId,
  tenantId,
  accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  slug: "acme-workspace",
  workspaceSlug: "acme-workspace",
  workspaceCode: "acme",
  displayName: "Acme",
  role: "operator",
  availableEnvironments: ["sandbox"],
};

const session = createDurableSequenceMcpSession({
  configUrl,
  fetch: fetchCore,
  authorize: async () => "synthetic-stdio-bearer",
});
const server = createFonteSequenceMcpServer(session);
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  }),
);

async function fetchCore(input, init = {}) {
  const url = String(input);
  if (url === configUrl) return json(hosted);
  if (init.headers?.authorization !== "Bearer synthetic-stdio-bearer") {
    return json({ error: { code: "human_auth_invalid" } }, 401);
  }

  const coreUrl = new URL(url);
  if (coreUrl.pathname === "/v1/workspaces") {
    return json({ workspaces: [workspace] });
  }
  if (coreUrl.pathname.endsWith("/campaign-configurations")) {
    return json({
      schemaVersion: "campaign_configuration.v1",
      tenantId,
      environment: "sandbox",
      configurations: [
        {
          workspaceId: tenantId,
          environment: "sandbox",
          campaignId,
          revision: 1,
          title: "Autumn",
          description: "",
          archived: false,
          createdAt: "2026-09-23T12:00:00.000Z",
          updatedAt: "2026-09-23T12:00:00.000Z",
          scopeBindingStatus: "not_qualified",
        },
      ],
      nextCursor: null,
    });
  }
  if (coreUrl.pathname.endsWith("/segments")) {
    return json({
      schemaVersion: "native_segment.v1",
      tenantId,
      environment: "sandbox",
      segments: [
        {
          segmentId,
          revision: 1,
          title: "Active",
          archived: false,
          createdAt: "2026-09-23T12:00:00.000Z",
          updatedAt: "2026-09-23T12:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  }
  if (coreUrl.pathname.endsWith("/sequences")) {
    return json({ tenantId, environment: "sandbox", rows: [] });
  }
  return json({ error: { code: "route_not_found" } }, 404);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
