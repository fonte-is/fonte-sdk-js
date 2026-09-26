import { z } from "zod";

const environmentSchema = z.enum(["sandbox", "production"]);
const roleSchema = z.enum(["viewer", "operator", "admin", "owner"]);

export const listWorkspacesInputSchema = z.object({}).strict();

const workspaceSummarySchema = z
  .object({
    slug: z
      .string()
      .min(2)
      .max(63)
      .regex(/^(?!.*--)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/),
    name: z.string().min(1).max(120),
    role: roleSchema,
    available_environments: z.array(environmentSchema).min(1).max(2),
  })
  .strict();

export const listWorkspacesOutputSchema = z
  .object({
    outcome: z.enum([
      "completed",
      "unavailable",
      "denied",
      "conflict",
      "ambiguous",
    ]),
    reason: z.string().min(1).max(100).nullable(),
    status_code: z.number().int().min(100).max(599).nullable(),
    core_effect: z.enum(["none", "unknown"]),
    workspaces: z.array(workspaceSummarySchema).max(500).nullable(),
  })
  .strict();
