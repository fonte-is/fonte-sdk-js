import { z } from "zod";

export const fonteStatusInputSchema = z.object({}).strict();

const workspaceSchema = z
  .object({
    slug: z.string().min(2).max(63),
    name: z.string().min(1).max(120),
  })
  .strict();

export const fonteStatusOutputSchema = z
  .object({
    schema: z.literal("fonte.readiness.v1"),
    state: z.enum([
      "ready",
      "login_required",
      "workspace_required",
      "repair_required",
      "unavailable",
    ]),
    reason: z
      .enum([
        "mcp_host_unavailable",
        "required_tools_missing",
        "local_sign_in_unavailable",
        "codex_configuration_unavailable",
        "workspace_context_unavailable",
        "sign_in_required",
        "workspace_catalog_unavailable",
        "workspace_access_required",
        "workspace_selection_required",
      ])
      .nullable(),
    next_action: z.string().min(1).max(240).nullable(),
    cli_version: z.string().min(1).max(40),
    capability_version: z.literal("fonte-mcp-catalog.v1"),
    authentication: z.enum(["ready", "required", "unavailable", "not_checked"]),
    selected_workspace: workspaceSchema.nullable(),
    workspace_choices: z.array(workspaceSchema).max(20),
    more_workspace_choices: z.boolean(),
    missing_tools: z.array(z.string().min(1).max(128)).max(27),
  })
  .strict();
