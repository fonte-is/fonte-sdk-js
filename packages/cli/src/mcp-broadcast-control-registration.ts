import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CoreOperatorError, type CoreRequester } from "./operator-core-request.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";

export const MCP_BROADCAST_CONTROL_TOOLS = [
  "fonte_read_broadcast_control", "fonte_cancel_broadcast",
] as const;

export function registerMcpBroadcastControlTools(
  server: McpServer,
  requester: () => Promise<CoreRequester | undefined>,
): void {
  const scope = { workspace: z.string().min(2).max(63), draft_id: z.string().uuid() };
  const annotations = { destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const path = (input: { workspace: string; draft_id: string }) =>
    `/v1/workspaces/${encodeURIComponent(input.workspace)}/broadcast-drafts/${input.draft_id}/send-intent`;
  const invoke = async (operation: (request: CoreRequester) => Promise<unknown>) => {
    try {
      const request = await requester();
      if (!request) throw new CoreOperatorError("core_operator_unavailable", null, "none");
      const receipt = await operation(request);
      const value = { outcome: "completed", receipt };
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch (error) {
      const value = sequenceMcpFailure(error);
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value, isError: true };
    }
  };
  server.registerTool(MCP_BROADCAST_CONTROL_TOOLS[0], {
    description: "Read the stored broadcast's current execution and control generation through Core. This never prepares, sends or advances work.",
    inputSchema: z.strictObject(scope),
    annotations: { ...annotations, readOnlyHint: true },
  }, input => invoke(request => request(`${path(input)}?environment=production`)));
  server.registerTool(MCP_BROADCAST_CONTROL_TOOLS[1], {
    description: "End remaining work for this exact broadcast using its observed control generation and a stable command ID. Core checks current send permission and the stored execution contract. Historical delivery and UNKNOWN evidence are retained; this never sends or retries.",
    inputSchema: z.strictObject({ ...scope, command_id: z.string().uuid(),
      expected_generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1) }),
    annotations: { ...annotations, readOnlyHint: false },
  }, input => invoke(request => request(`${path(input)}/control?environment=production`, {
    body: { commandId: input.command_id, expectedGeneration: input.expected_generation, action: "cancel" },
    lostResponseEffect: "unknown",
  })));
}
