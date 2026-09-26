import { readFonteReadiness } from "./mcp-readiness.js";
import type { FonteReadinessReader } from "./mcp-readiness.js";
import {
  fonteStatusInputSchema,
} from "./mcp-status-types.js";

export { MCP_FONTE_STATUS_TOOL } from "./mcp-status-types.js";

export function createFonteStatusToolHandler(
  reader: FonteReadinessReader,
): (input: unknown) => ReturnType<typeof readFonteReadiness> {
  return async (input) => {
    fonteStatusInputSchema.parse(input);
    return readFonteReadiness(reader);
  };
}
