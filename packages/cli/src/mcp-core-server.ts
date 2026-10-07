import { z } from "zod";
import { createFonteMcpServer, type FonteMcpClientProviders } from "./mcp-sequence-server.js";
import { MCP_FONTE_TOOLS } from "./mcp-tool-inventory.js";
import { CoreOperatorError, type CoreRequester } from "./operator-core-request.js";
import { createBroadcastDraftLifecycleClient } from "./operator-broadcast-draft-lifecycle-client.js";
import { createBroadcastDraftRevisionClient } from "./operator-broadcast-draft-revision-client.js";
import { createBroadcastSenderClient } from "./operator-broadcast-sender-client.js";
import { createBroadcastTargetingClient } from "./operator-broadcast-targeting-client.js";
import { createBroadcastRenderTestClient } from "./operator-broadcast-render-test-client.js";
import { createWorkspaceCatalogClient, resolveAuthorizedWorkspaceId } from "./operator-workspace-catalog-client.js";
import { createSequenceAuthoringClient } from "./operator-sequence-client.js";
import { createCampaignMetadataClient } from "./operator-campaign-client.js";
import { createSegmentMetadataClient } from "./operator-segment-client.js";
import { createProductionDraftClient } from "./operator-production-draft-client.js";
import { sequenceMcpFailure } from "./mcp-sequence-failure.js";

const unhosted = new Set([
  "fonte_recover_broadcast_request", "fonte_prepare_broadcast_html_file", "fonte_revise_broadcast_html_file",
  "fonte_send_broadcast_now", "fonte_schedule_broadcast", "fonte_replace_broadcast_schedule",
  "fonte_cancel_broadcast_send", "fonte_increase_broadcast_spend_limit",
  "fonte_read_legacy_broadcast_send_operation",
]);
const extraTools = ["fonte_list_broadcast_options", "fonte_create_broadcast_recipient_set",
  "fonte_read_broadcast_recipient_set", "fonte_read_broadcast_results", "fonte_read_broadcast_recipients",
  "fonte_read_sender_domains", "fonte_migrate_sender_domain", "fonte_reconcile_sender_domain"];
export const MCP_HOSTED_TOOLS = [...MCP_FONTE_TOOLS.filter(name => !unhosted.has(name)), ...extraTools];

/** Core mounts this registry in its own API runtime. No upstream credential,
 * local login, filesystem, selected-workspace file or shared request store exists. */
export function createCoreFonteMcpServer(request: CoreRequester, coreApiBaseUrl: string) {
  const revision = createBroadcastDraftRevisionClient(request);
  const catalog = createWorkspaceCatalogClient(request);
  const unsupported = async (): Promise<never> => {
    throw new CoreOperatorError("hosted_local_file_unsupported", null, "none");
  };
  const providers: FonteMcpClientProviders = {
    broadcastBg: async () => ({ coreApiBaseUrl, request, requestCustody: "caller",
      resolveWorkspaceId: (workspace, timeoutMs) => resolveAuthorizedWorkspaceId(request, workspace, timeoutMs),
      sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }),
    workspaceCatalog: async () => catalog,
    sequence: async () => createSequenceAuthoringClient(request),
    broadcastDraftLifecycle: async () => createBroadcastDraftLifecycleClient(request),
    broadcastDraftRevision: async () => revision,
    broadcastSender: async () => createBroadcastSenderClient(request, revision),
    broadcastTargeting: async () => createBroadcastTargetingClient(request),
    broadcastRenderTest: async () => createBroadcastRenderTestClient(request),
    broadcastSendInstruction: unsupported,
    canonicalBroadcast: unsupported,
    broadcastRecipientSets: unsupported,
    broadcastHtmlPreparation: unsupported,
    campaignMetadata: async () => createCampaignMetadataClient(request),
    segmentMetadata: async () => createSegmentMetadataClient(request),
    productionDrafts: async () => createProductionDraftClient(request),
  };
  // This cache is scoped to one authenticated HTTP request only. Every later
  // tool call resolves membership again through the ordinary Core route.
  const workspaces = async () => {
    const value = await catalog.listWorkspaces();
    return value.map(workspace => ({ slug: workspace.slug, name: workspace.name }));
  };
  const server = createFonteMcpServer(providers, {
    requiredTools: MCP_HOSTED_TOOLS,
    inspectHost: async () => ({ initialized: true, tools: MCP_HOSTED_TOOLS }),
    readSession: async () => ({ status: { state: "ready", serverCheck: "not_checked" }, storageAvailable: true }),
    listWorkspaces: workspaces,
    readSelectedWorkspace: async () => {
      const choices = await workspaces();
      return choices.length === 1 ? choices[0]!.slug : null;
    },
  }, { hosted: true });
  const scope = { workspace: z.string().min(2).max(63), draft_id: z.string().uuid() };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const register = (name: string, schema: z.ZodType, description: string,
    mutation: boolean, operation: (input: any) => Promise<unknown>) => {
    server.registerTool(name, { description, inputSchema: schema,
      annotations: { ...read, readOnlyHint: !mutation } }, async input => {
      try {
        const receipt = await operation(input);
        const value = { outcome: "completed", receipt };
        return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
      } catch (error) {
        const value = sequenceMcpFailure(error);
        return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value, isError: true };
      }
    });
  };
  register(extraTools[0]!, z.strictObject({ workspace: scope.workspace }),
    "Discover Core-authorized current senders, communication purposes and audience choices.", false, async input => ({
      senders: await createBroadcastSenderClient(request, revision).listBroadcastSenders({ workspace: input.workspace, match: null }),
      audience: await createProductionDraftClient(request).listProductionAudienceOptions({ workspace: input.workspace }),
    }));
  register(extraTools[1]!, z.strictObject({ ...scope, set_id: z.string().uuid(), request_id: z.string().uuid(),
    expected_draft_version: z.number().int().positive(), csv_text: z.string().min(1).max(65_536),
    permission_confirmed: z.literal(true),
    source_file_name: z.string().regex(/^[A-Za-z0-9._-]{1,100}\.csv$/).default("recipients.csv") }),
    "Create one broadcast-only recipient set from bounded inline CSV after the caller confirms permission for the exact recipients. Start with an empty selected audience. Core validates, imports and authorizes the exact rows; this never adds them to Everyone or sends.", true,
    input => request(`${draftPath(input)}/recipient-sets?environment=production`, {
      body: { setId: input.set_id, clientRequestKey: input.request_id,
        expectedDraftVersion: input.expected_draft_version, csvText: input.csv_text,
        sourceFileName: input.source_file_name, usage: "include",
        intake: { permissionConfirmed: input.permission_confirmed } }, lostResponseEffect: "unknown" }));
  register(extraTools[2]!, z.strictObject({ ...scope, set_id: z.string().uuid() }),
    "Read the exact Core-owned broadcast-only recipient-set operation without recipient rows.", false,
    input => request(`${draftPath(input)}/recipient-sets/${input.set_id}?environment=production`));
  register(extraTools[3]!, z.strictObject(scope),
    "Read Core's delivery and engagement counts and per-link recorded click reporting for one broadcast.", false,
    input => request(`${draftPath(input)}/send/results?environment=production`));
  register(extraTools[4]!, z.strictObject({ ...scope,
    outcome: z.enum(["delivered", "opened", "clicked", "bounced", "suppressed", "unsubscribed", "complained"]),
    cursor: z.string().regex(/^(0|[1-9][0-9]*)$/).max(16).nullable().default(null) }),
    "Read one bounded Core-authorized recipient outcome page, including recorded destinations for Clicked.", false,
    input => request(`${draftPath(input)}/send/recipient-activity?environment=production&outcome=${input.outcome}`
      + (input.cursor === null ? "" : `&cursor=${input.cursor}`)));
  const domainScope = { workspace: scope.workspace, email_domain_id: z.string().uuid() };
  const domainPath = (input: { workspace: string }) =>
    `/v1/workspaces/${encodeURIComponent(input.workspace)}/delivery/sender-domains?environment=production`;
  register(extraTools[5]!, z.strictObject({ workspace: scope.workspace }),
    "Read the workspace's sender domains, permanent DNS instructions and current migration readiness.", false,
    input => request(domainPath(input)));
  register(extraTools[6]!, z.strictObject({ ...domainScope,
    expected_revision: z.number().int().positive(), phase: z.enum(["begin", "cutover"]) }),
    "Stage permanent Fonte DNS for an existing domain, or cut over after Core verifies DNS and readiness. Requires a workspace owner or admin and the current revision. This never sends mail.", true,
    input => request(domainPath(input), { method: "PUT", body: {
      operation: input.phase === "begin" ? "begin_existing_domain_migration" : "cutover_existing_domain_migration",
      emailDomainId: input.email_domain_id, expectedRevision: input.expected_revision,
    }, lostResponseEffect: "unknown" }));
  register(extraTools[7]!, z.strictObject(domainScope),
    "Recheck the exact workspace domain's DNS and sender readiness through Core's existing domain owner. Requires a workspace owner or admin. This never sends mail.", true,
    input => request(domainPath(input), { method: "PUT", body: {
      operation: "reconcile_email_domain", emailDomainId: input.email_domain_id,
    }, lostResponseEffect: "unknown" }));
  return server;
}
function draftPath(input: { workspace: string; draft_id: string }) {
  return `/v1/workspaces/${encodeURIComponent(input.workspace)}/broadcast-drafts/${input.draft_id}`;
}
