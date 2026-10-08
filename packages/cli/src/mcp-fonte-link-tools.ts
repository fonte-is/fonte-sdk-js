import { z } from "zod";
import { CoreOperatorError, type CoreRequester } from "./operator-core-request.js";

export const MCP_LINK_TOOLS = ["fonte_list_links", "fonte_create_link", "fonte_read_link",
  "fonte_create_link_copy", "fonte_read_link_metrics", "fonte_read_link_clicks",
  "fonte_read_link_lifecycle", "fonte_read_broadcast_status"] as const;

type Register = (name: string, schema: z.ZodType, description: string,
  mutation: boolean, operation: (input: any) => Promise<unknown>) => void;

/** The existing Core routes retain workspace membership, role, ownership,
 * stable mutation IDs, bounded reporting and all business state. */
export function registerFonteLinkTools(register: Register, request: CoreRequester): void {
  const workspace = z.string().min(2).max(63);
  const scope = { workspace, link_id: z.string().uuid() };
  const text = z.string().trim().min(1).max(120);
  const reference = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
  const sourceContext = z.strictObject({ campaignRef: reference.optional(), cohortRef: reference.optional(),
    companyRef: reference.optional(), contactRef: reference.optional(), channel: reference.optional(),
    messageVersion: reference.optional() });
  const collection = (input: { workspace: string }) => `/v1/workspaces/${encodeURIComponent(input.workspace)}/links`;
  const item = (input: { workspace: string; link_id: string }) => `${collection(input)}/${input.link_id}`;
  const destination = z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  });
  register(MCP_LINK_TOOLS[0], z.strictObject({ workspace }),
    "List the workspace's Fonte Links and their issued fl_ placement URLs. Core enforces current membership and returns a bounded page.", false,
    input => request(`${collection(input)}?environment=production`));
  register(MCP_LINK_TOOLS[1], z.strictObject({ workspace, client_mutation_id: z.string().uuid(),
    name: text, destination_url: destination }),
    "Create a Fonte Link through its existing workspace owner using a stable mutation ID. Core returns the real ?fonte=fl_ URL. This does not send a broadcast or follow the destination.", true,
    input => request(`${collection(input)}?environment=production`, { body: {
      clientMutationId: input.client_mutation_id, name: input.name, destinationUrl: input.destination_url,
    }, lostResponseEffect: "unknown" }));
  register(MCP_LINK_TOOLS[2], z.strictObject(scope),
    "Read one Core-owned Fonte Link and its issued placements within the selected workspace.", false,
    input => request(`${item(input)}?environment=production`));
  register(MCP_LINK_TOOLS[3], z.strictObject({ ...scope, client_mutation_id: z.string().uuid(),
    kind: z.enum(["qr", "share"]), label: text, source_context: sourceContext.optional() }),
    "Issue a named Fonte Link placement with a stable mutation ID. Source context describes the issued touch, not the identity of whoever later clicks. Core validates link ownership and placement limits.", true,
    input => request(`${item(input)}/copies?environment=production`, { body: {
      clientMutationId: input.client_mutation_id, kind: input.kind, label: input.label,
      ...(input.source_context === undefined ? {} : { sourceContext: input.source_context }),
    }, lostResponseEffect: "unknown" }));
  register(MCP_LINK_TOOLS[4], z.strictObject(scope),
    "Read Core's Fonte Link request, bot, confirmed-visit and account-outcome evidence. Browser evidence is not authenticated person identity; a raw request alone is not a confirmed visit.", false,
    input => request(`${item(input)}/metrics?environment=production`));
  register(MCP_LINK_TOOLS[5], z.strictObject({ ...scope,
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).nullable().default(null) }),
    "Read one bounded Fonte Link request-evidence page with exact placement IDs, classification and confirmed-visit flags. Preserve Core's opaque cursor.", false,
    input => request(`${item(input)}/clicks?environment=production`
      + (input.cursor === null ? "" : `&cursor=${encodeURIComponent(input.cursor)}`)));
  register(MCP_LINK_TOOLS[6], z.strictObject(scope),
    "Read Core's Fonte Link lifecycle and landing attribution evidence for the selected workspace.", false,
    input => request(`${item(input)}/lifecycle?environment=production`));
  register(MCP_LINK_TOOLS[7], z.strictObject({ workspace, draft_id: z.string().uuid() }),
    "Read Core's canonical broadcast phase, completion and counts. This never prepares, sends, retries or changes control state.", false,
    async input => {
      const raw = await request(`/v1/workspaces/${encodeURIComponent(input.workspace)}/broadcast-drafts/${input.draft_id}?environment=production`);
      const value = raw as { environment?: unknown; draft?: { broadcastDraftId?: unknown; canonicalSend?: unknown } };
      const draft = value?.draft;
      if (value?.environment !== "production" || !draft || draft.broadcastDraftId !== input.draft_id)
        throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
      return { draftId: input.draft_id, environment: "production", canonicalSend: draft.canonicalSend ?? null };
    });
}
