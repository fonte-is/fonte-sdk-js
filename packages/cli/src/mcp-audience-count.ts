import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { audienceCountInputSchema, audienceCountResultSchemaV1, type AudienceCountInput, type AudienceCountResultV1 } from "./broadcast-audience-count-client.js";
import { CoreOperatorError } from "./operator-core-request.js";

export const MCP_AUDIENCE_COUNT_TOOL = "fonte_count_broadcast_audience" as const;
export type AudienceCountClientProvider = () => Promise<{ count(input: AudienceCountInput): Promise<AudienceCountResultV1> }>;
const output = z.strictObject({ outcome: z.enum(["completed", "failed"]),
  count: audienceCountResultSchemaV1.nullable(), reason: z.string().nullable(), status_code: z.number().int().nullable() });
export type AudienceCountMcpResult = z.output<typeof output>;

export function createAudienceCountToolHandler(provider: AudienceCountClientProvider): (input: unknown) => Promise<AudienceCountMcpResult> {
  return async input => {
    const checked = audienceCountInputSchema.parse(input);
    try {
      const client = await provider();
      return { outcome: "completed", count: await client.count(checked), reason: null, status_code: null };
    } catch (error) {
      return { outcome: "failed", count: null,
        reason: error instanceof CoreOperatorError ? error.reason : "audience_count_unavailable",
        status_code: error instanceof CoreOperatorError ? error.statusCode : null };
    }
  };
}

export function registerMcpAudienceCountTool(server: McpServer, provider: AudienceCountClientProvider): void {
  const handler = createAudienceCountToolHandler(provider);
  server.registerTool(MCP_AUDIENCE_COUNT_TOOL, {
    title: "Count Broadcast audience",
    description: "Count the current unsaved targeting selection through the authenticated Core audience index. No draft save or Send effect.",
    inputSchema: audienceCountInputSchema, outputSchema: output,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const result = await handler(input);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
}
