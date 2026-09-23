import type { McpServer } from "@modelcontextprotocol/server";

import {
  broadcastPavedPreparationOutputSchema,
  broadcastPavedSendOutputSchema,
  prepareBroadcastPavedInputSchema,
  sendPreparedBroadcastInputSchema,
} from "./mcp-broadcast-paved-types.js";
import {
  createBroadcastPavedToolHandlers,
  MCP_BROADCAST_PREPARE_PAVED_TOOL,
  MCP_BROADCAST_SEND_PAVED_TOOL,
} from "./mcp-broadcast-paved-tools.js";
import type { BroadcastPavedOperator } from "./operator-broadcast-paved.js";

const prepareAnnotation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const sendAnnotation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpBroadcastPavedTools(
  server: McpServer,
  operator: BroadcastPavedOperator,
): void {
  const handlers = createBroadcastPavedToolHandlers(operator);
  server.registerTool(
    MCP_BROADCAST_PREPARE_PAVED_TOOL,
    {
      title: "Prepare Broadcast",
      description:
        "Creates or updates one exact Broadcast draft, resolves only unambiguous current workspace/sender/purpose choices, and returns current factual readiness. It never Sends, Schedules, Test Sends, counts recipients, prepares an audience, or calls a provider. Pass the returned send_input unchanged to fonte_send_broadcast only when status is ready_to_send.",
      inputSchema: prepareBroadcastPavedInputSchema,
      outputSchema: broadcastPavedPreparationOutputSchema,
      annotations: prepareAnnotation,
    },
    async (input) => result(await handlers.prepare(input)),
  );
  server.registerTool(
    MCP_BROADCAST_SEND_PAVED_TOOL,
    {
      title: "Send prepared Broadcast",
      description:
        "Accepts only the exact preparation_reference returned inside a ready_to_send send_input. It rereads the exact draft revision and fails closed on any drift, then accepts one ordinary v3 Send-now operation and returns the existing OperatorReceipt semantics. It does not reprepare, change sender/target/content, Schedule, Test Send, or repeat under a new request identity.",
      inputSchema: sendPreparedBroadcastInputSchema,
      outputSchema: broadcastPavedSendOutputSchema,
      annotations: sendAnnotation,
    },
    async (input) => result(await handlers.send(input)),
  );
}

function result<Value extends object>(value: Value) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
