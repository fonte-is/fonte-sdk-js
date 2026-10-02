import { z } from "zod";
import { mcpWorkspaceSchema, mcpOutcomeSchema } from "./mcp-broadcast-render-types.js";
import { broadcastPersonalizationSchemaResultSchema } from "./operator-broadcast-personalization-types.js";

export const readBroadcastPersonalizationSchemaInputSchema = z.object({
  workspace: mcpWorkspaceSchema, environment: z.enum(["sandbox", "production"]).optional(),
}).strict();
export const readBroadcastPersonalizationSchemaOutputSchema = z.object({
  outcome: mcpOutcomeSchema, reason: z.string().nullable(), status_code: z.number().nullable(),
  core_effect: z.literal("none"), schema: broadcastPersonalizationSchemaResultSchema.nullable(),
}).strict();
