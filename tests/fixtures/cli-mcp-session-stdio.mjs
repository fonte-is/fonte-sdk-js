import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { HostedTestBlockedError } from "../../packages/cli/dist/hosted-errors.js";
import {
  createDurableSequenceMcpSession,
  createFonteSequenceMcpServer,
} from "../../packages/cli/dist/mcp-sequence-server.js";

const configUrl = "http://127.0.0.1:43111/.well-known/fonte-cli.json";
const hosted = {
  schema: "fonte.cli.hosted_config.v1",
  authorizationServer: "https://identity.example.test/auth/v1",
  clientId: "fonte-cli-client-v0",
  coreApiBaseUrl: "https://api.example.test",
  redirectUri: "http://127.0.0.1:49671/callback",
  scopes: ["email"],
};
let authorizations = 0;
const session = createDurableSequenceMcpSession({
  configUrl,
  fetch: async (input) => {
    if (String(input) === configUrl) return json(hosted);
    return json({ tenantId: "tenant_demo", environment: "sandbox", rows: [] });
  },
  authorize: async () => {
    authorizations += 1;
    if (authorizations > 1) throw new HostedTestBlockedError("login_required");
    return "synthetic-stdio-bearer";
  },
});
const server = createFonteSequenceMcpServer(session);
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  }),
);

function json(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
