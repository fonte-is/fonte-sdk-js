import { sequenceMcpFailure } from "./mcp-sequence-failure.js";
import type {
  WorkspaceCatalogClient,
  WorkspaceSummary,
} from "./operator-workspace-catalog-client.js";
import { listWorkspacesInputSchema } from "./mcp-workspace-catalog-types.js";

export const MCP_WORKSPACE_LIST_TOOL = "fonte_list_workspaces" as const;

export type WorkspaceCatalogClientProvider =
  () => Promise<WorkspaceCatalogClient>;

interface WorkspaceListFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
  readonly workspaces: null;
}

export function createListWorkspacesToolHandler(
  provider: WorkspaceCatalogClientProvider,
): (input: unknown) => Promise<
  | WorkspaceListFailure
  | {
      readonly outcome: "completed";
      readonly reason: null;
      readonly status_code: null;
      readonly core_effect: "none";
      readonly workspaces: readonly WorkspaceSummary[];
    }
> {
  return async (input) => {
    listWorkspacesInputSchema.parse(input);
    try {
      const client = await provider();
      return {
        outcome: "completed",
        reason: null,
        status_code: null,
        core_effect: "none",
        workspaces: await client.listWorkspaces(),
      };
    } catch (error) {
      return { ...sequenceMcpFailure(error), workspaces: null };
    }
  };
}
