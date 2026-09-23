import { readFonteReadiness } from "./mcp-readiness.js";
import type { FonteReadinessReader } from "./mcp-readiness.js";
import { fonteStatusInputSchema } from "./mcp-status-types.js";

export const MCP_FONTE_STATUS_TOOL = "fonte_status" as const;

export function createFonteStatusToolHandler(
  reader: FonteReadinessReader,
): (input: unknown) => ReturnType<typeof readFonteReadiness> {
  return async (input) => {
    fonteStatusInputSchema.parse(input);
    return readFonteReadiness(reader);
  };
}
