import type { McpServer } from "@modelcontextprotocol/server";

import {
  createSegmentToolHandlers,
  MCP_SEGMENT_TOOLS,
  type SegmentMcpClientProvider,
} from "./mcp-segment-tools.js";
import {
  createSegmentInputSchema,
  listSegmentsInputSchema,
  readSegmentCommandInputSchema,
  readSegmentInputSchema,
  segmentOperatorReceiptSchema,
  setSegmentArchivedInputSchema,
  updateSegmentInputSchema,
} from "./mcp-segment-types.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const reversibleMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerMcpSegmentTools(
  server: McpServer,
  provider: SegmentMcpClientProvider,
): void {
  const handlers = createSegmentToolHandlers(provider);
  const outputSchema = segmentOperatorReceiptSchema;
  server.registerTool(
    MCP_SEGMENT_TOOLS[0],
    {
      title: "List Segment metadata",
      description:
        "Lists Core-authorized native Segment metadata for one workspace and environment.",
      inputSchema: listSegmentsInputSchema,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.list(input)),
  );
  server.registerTool(
    MCP_SEGMENT_TOOLS[1],
    {
      title: "Read Segment revision",
      description:
        "Reads one exact or current Core-owned native Segment revision.",
      inputSchema: readSegmentInputSchema,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.read(input)),
  );
  server.registerTool(
    MCP_SEGMENT_TOOLS[2],
    {
      title: "Create native Segment",
      description:
        "Creates one native Segment definition. Core validates the rule; this tool does not evaluate it or derive membership.",
      inputSchema: createSegmentInputSchema,
      outputSchema,
      annotations: reversibleMutation,
    },
    async (input) => result(await handlers.create(input)),
  );
  server.registerTool(
    MCP_SEGMENT_TOOLS[3],
    {
      title: "Update native Segment",
      description:
        "Revision-checks and saves one native Segment rule through Core without local evaluation.",
      inputSchema: updateSegmentInputSchema,
      outputSchema,
      annotations: reversibleMutation,
    },
    async (input) => result(await handlers.update(input)),
  );
  server.registerTool(
    MCP_SEGMENT_TOOLS[4],
    {
      title: "Archive or restore native Segment",
      description:
        "Revision-checks an archive-state change for one native Segment.",
      inputSchema: setSegmentArchivedInputSchema,
      outputSchema,
      annotations: reversibleMutation,
    },
    async (input) => result(await handlers.setArchived(input)),
  );
  server.registerTool(
    MCP_SEGMENT_TOOLS[5],
    {
      title: "Read Segment command receipt",
      description: "Reads the Core receipt for one Segment operation UUID.",
      inputSchema: readSegmentCommandInputSchema,
      outputSchema,
      annotations: readOnly,
    },
    async (input) => result(await handlers.receipt(input)),
  );
}

function result<Value extends object>(value: Value) {
  const blocked = "outcome" in value && value.outcome === "blocked";
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(blocked ? { isError: true } : {}),
  };
}
