import { writeFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import {
  createDurableFonteMcpSession,
  createFonteMcpServer,
  MCP_FONTE_TOOLS,
} from "../../packages/cli/dist/mcp-sequence-server.js";

const configUrl = "https://config.example.test/.well-known/fonte-cli.json";
const proofPath = process.env.FON742_PROOF_FILE;
let providerAcquisitions = 0;
let coreRequests = 0;
const session = createDurableFonteMcpSession({
  configUrl,
  fetch: async () => {
    coreRequests += 1;
    throw new Error("unexpected_core_request");
  },
  authorize: async () => {
    throw new Error("unexpected_authorization");
  },
});
for (const name of Object.keys(session)) {
  const provider = session[name];
  if (typeof provider !== "function") continue;
  session[name] = async (...args) => {
    providerAcquisitions += 1;
    return provider(...args);
  };
}

const readinessReader = {
  async inspectHost() {
    return { initialized: true, tools: MCP_FONTE_TOOLS };
  },
  async readSession() {
    return {
      status: { state: "ready", serverCheck: "not_checked" },
      storageAvailable: true,
    };
  },
  async listWorkspaces() {
    return [{ slug: "demo-workspace", name: "Demo Workspace" }];
  },
  async readSelectedWorkspace() {
    return "demo-workspace";
  },
};

const server = createFonteMcpServer(session, readinessReader);
process.once("SIGTERM", () => {
  if (proofPath) {
    writeFileSync(
      proofPath,
      JSON.stringify({ providerAcquisitions, coreRequests }),
      "utf8",
    );
  }
  process.exit(0);
});
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 1_048_576,
  }),
);
