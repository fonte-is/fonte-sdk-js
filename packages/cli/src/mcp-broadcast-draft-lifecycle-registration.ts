import type { McpServer } from "@modelcontextprotocol/server";

import {
  broadcastDraftLifecycleOutputSchema,
  createBroadcastDraftInputSchema,
  readBroadcastDraftInputSchema,
} from "./mcp-broadcast-draft-lifecycle-types.js";
import {
  createBroadcastDraftCreateToolHandler,
  createBroadcastDraftReadToolHandler,
  MCP_BROADCAST_DRAFT_CREATE_TOOL,
  MCP_BROADCAST_DRAFT_READ_TOOL,
  type BroadcastDraftLifecycleClientProvider,
} from "./mcp-broadcast-draft-lifecycle-tools.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const create = { ...readOnly, readOnlyHint: false } as const;

export function registerMcpBroadcastDraftLifecycleTools(
  server: McpServer,
  provider: BroadcastDraftLifecycleClientProvider,
): void {
  const createHandler = createBroadcastDraftCreateToolHandler(provider);
  const readHandler = createBroadcastDraftReadToolHandler(provider);
  server.registerTool(
    MCP_BROADCAST_DRAFT_CREATE_TOOL,
    {
      title: "Create Broadcast draft",
      description:
        "Idempotently creates one content-first unsent production draft. Missing sender, targeting and purpose remain explicit nulls.",
      inputSchema: createBroadcastDraftInputSchema,
      outputSchema: broadcastDraftLifecycleOutputSchema,
      annotations: create,
    },
    async (input) => result(await createHandler(input)),
  );
  server.registerTool(
    MCP_BROADCAST_DRAFT_READ_TOOL,
    {
      title: "Read Broadcast draft",
      description:
        "Reads one exact persisted unsent production draft and its source copies without inferring readiness.",
      inputSchema: readBroadcastDraftInputSchema,
      outputSchema: broadcastDraftLifecycleOutputSchema,
      annotations: readOnly,
    },
    async (input) => result(await readHandler(input)),
  );
}

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
