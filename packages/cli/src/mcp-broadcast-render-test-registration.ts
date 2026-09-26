import type { McpServer } from "@modelcontextprotocol/server";

import {
  createBroadcastRenderToolHandler,
  createBroadcastTestReadToolHandler,
  createBroadcastTestRequestToolHandler,
  MCP_BROADCAST_RENDER_TOOL,
  MCP_BROADCAST_TEST_READ_TOOL,
  MCP_BROADCAST_TEST_REQUEST_TOOL,
  type BroadcastRenderTestClientProvider,
} from "./mcp-broadcast-render-test-tools.js";
import {
  renderBroadcastDraftInputSchema,
  renderBroadcastDraftOutputSchema,
} from "./mcp-broadcast-render-types.js";
import {
  readBroadcastTestInputSchema,
  readBroadcastTestOutputSchema,
  requestBroadcastTestInputSchema,
  requestBroadcastTestOutputSchema,
} from "./mcp-broadcast-test-types.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const testMutation = { ...readOnly, readOnlyHint: false } as const;

export function registerMcpBroadcastRenderTestTools(
  server: McpServer,
  provider: BroadcastRenderTestClientProvider,
): void {
  const render = createBroadcastRenderToolHandler(provider);
  const requestTest = createBroadcastTestRequestToolHandler(provider);
  const readTest = createBroadcastTestReadToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_RENDER_TOOL,
    {
      title: "Render Broadcast draft",
      description:
        "Reads Core's canonical render and same-finalizer inspection sample for one exact saved revision.",
      inputSchema: renderBroadcastDraftInputSchema,
      outputSchema: renderBroadcastDraftOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await render(input)),
  );
  server.registerTool(
    MCP_BROADCAST_TEST_REQUEST_TOOL,
    {
      title: "Request Broadcast test",
      description:
        "Requests an idempotent verified-account test fenced to a prior Core render proof. Caller MIME and recipients are not accepted.",
      inputSchema: requestBroadcastTestInputSchema,
      outputSchema: requestBroadcastTestOutputSchema,
      annotations: testMutation,
    },
    async (input) => result(await requestTest(input)),
  );
  server.registerTool(
    MCP_BROADCAST_TEST_READ_TOOL,
    {
      title: "Read Broadcast test result",
      description:
        "Reads provider acceptance and delivery feedback without inferring inbox confirmation.",
      inputSchema: readBroadcastTestInputSchema,
      outputSchema: readBroadcastTestOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await readTest(input)),
  );
}

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
