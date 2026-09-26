import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  createDurableFonteMcpSession,
  createFonteMcpServer,
  MCP_FONTE_TOOLS,
} from "../../packages/cli/dist/mcp-sequence-server.js";
import { createAuthenticatedBroadcastProvider } from "../../packages/cli/dist/broadcast-runtime.js";
import { createBroadcastFileStore } from "../../packages/cli/dist/broadcast-file-store.js";
import {
  coreOrigin,
  scope,
  workspaceId,
  ready,
  processing,
  json,
} from "./broadcast-bg1.mjs";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: coreOrigin,
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
const options = {
  configUrl,
  authorize: async () => "synthetic-bg1-composition-bearer",
  fetch: async (input, init = {}) => {
    if (String(input) === configUrl) return json(hosted);
    const url = new URL(String(input));
    if (url.origin !== coreOrigin) throw new Error("unexpected origin");
    if (url.pathname === "/v1/workspaces")
      return json({
        workspaces: [
          {
            workspaceId,
            tenantId: "tenant_bg1",
            accountId: "account_bg1",
            slug: scope.workspace,
            workspaceSlug: scope.workspace,
            workspaceCode: scope.workspace,
            displayName: "Synthetic BG-1",
            role: "owner",
            availableEnvironments: ["sandbox"],
          },
        ],
      });
    if (url.pathname.endsWith("/broadcast-review")) return json(ready);
    if (url.pathname.endsWith("/send")) return json(processing);
    throw new Error(`unexpected Core path ${url.pathname}`);
  },
};
const session = createDurableFonteMcpSession(options);
const providers = {
  ...session,
  broadcastBg: createAuthenticatedBroadcastProvider({
    ...options,
    store: createBroadcastFileStore(process.argv[2]),
  }),
};
const readiness = {
  inspectHost: async () => ({ initialized: true, tools: MCP_FONTE_TOOLS }),
  readSession: async () => ({
    status: { state: "ready", serverCheck: "not_checked" },
    storageAvailable: true,
  }),
  listWorkspaces: async () => [
    { slug: scope.workspace, name: "Synthetic BG-1" },
  ],
  readSelectedWorkspace: async () => scope.workspace,
};
await createFonteMcpServer(providers, readiness).connect(
  new StdioServerTransport(process.stdin, process.stdout),
);
