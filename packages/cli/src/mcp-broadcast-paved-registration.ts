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
        "Creates or updates one exact Broadcast draft, starts or reads the durable audience Prepare operation, and returns a commercial review when the recipient manifest is ready. It never Sends or calls an email provider. Pass the returned send_input unchanged to fonte_send_broadcast only when status is ready_to_send.",
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
        "Accepts only the exact reviewed send_input returned by ready_to_send Prepare. It rereads the draft, confirms the commercial review, posts canonical Send once, and reads back the same executable operation if the response is ambiguous. It never generates a new request identity or repeats the Send POST.",
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
