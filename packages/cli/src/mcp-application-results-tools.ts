import { z } from "zod";
import type { CoreRequester } from "./operator-core-request.js";

export const MCP_APPLICATION_RESULTS_TOOLS = ["fonte_read_application", "fonte_connect_application",
  "fonte_save_application_settings", "fonte_disconnect_application", "fonte_rotate_application_key",
  "fonte_read_broadcast_results_definition", "fonte_bind_broadcast_results",
  "fonte_read_broadcast_outcomes"] as const;

type Register = (name: string, schema: z.ZodType, description: string,
  mutation: boolean, operation: (input: any) => Promise<unknown>) => void;

/** Ordinary application and Results routes own authorization, credentials,
 * identity, immutable definitions, privacy and all attribution calculations. */
export function registerApplicationResultsTools(register: Register, request: CoreRequester): void {
  const workspace = z.string().min(2).max(63);
  const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
  const trigger = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
  const label = z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/);
  const origin = z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.origin === value;
  });
  const configuration = z.strictObject({ schema: z.literal("fonte.application.source.v2"), origin,
    triggers: z.array(z.strictObject({ key: trigger, label })).max(5),
    activityGranted: z.boolean(), identityLinkGranted: z.boolean(), policyVersion: z.literal("fonte_measurement.v1"),
    postHog: z.strictObject({ projectId: z.string().regex(/^[1-9][0-9]{0,18}$/),
      producer: z.literal("signed_native_trigger.v1"), mappings: z.array(z.strictObject({
        event: z.string().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/).refine(value => value.trim() === value),
        trigger,
      })).min(1).max(5) }).optional(),
  }).refine(value => new Set(value.triggers.map(item => item.key)).size === value.triggers.length
    && (!value.postHog || (new Set(value.postHog.mappings.map(item => item.event)).size === value.postHog.mappings.length
      && value.postHog.mappings.every(item => value.triggers.some(selected => selected.key === item.trigger)))));
  const write = z.strictObject({ workspace, operation_id: z.string().uuid(), expected_revision: revision, configuration });
  const app = (input: { workspace: string }) => `/v1/workspaces/${encodeURIComponent(input.workspace)}/application`;
  const body = (input: z.infer<typeof write>) => ({ operationId: input.operation_id,
    expectedRevision: input.expected_revision, configuration: input.configuration });
  const scope = { workspace, draft_id: z.string().uuid() };
  const draft = (input: { workspace: string; draft_id: string }) =>
    `/v1/workspaces/${encodeURIComponent(input.workspace)}/broadcast-drafts/${input.draft_id}`;
  register(MCP_APPLICATION_RESULTS_TOOLS[0], z.strictObject({ workspace }),
    "Read the production application's current connection, grants, selected actions and Source revision. Credentials are not returned.", false,
    input => request(`${app(input)}?environment=production`));
  register(MCP_APPLICATION_RESULTS_TOOLS[1], write,
    "Connect the application's production origin and selected successful actions through Core. Requires a workspace owner or admin, explicit measurement grants, a stable operation ID and current revision (0 for first setup). Returns a server-only installation key once: keep it in the application's secret configuration. After response loss, read the Source and explicitly rotate its key; do not assume a replay returns that key.", true,
    input => request(`${app(input)}?environment=production`, { method: "PUT", body: body(input), lostResponseEffect: "unknown" }));
  register(MCP_APPLICATION_RESULTS_TOOLS[2], write,
    "Save selected actions and measurement grants against the observed Source revision without rotating its key or reconnecting a disconnected Source. Core fences stale configuration and PostHog commit proofs.", true,
    input => request(`${app(input)}?environment=production`, { method: "PATCH", body: body(input), lostResponseEffect: "unknown" }));
  register(MCP_APPLICATION_RESULTS_TOOLS[3], z.strictObject({ workspace }),
    "Disconnect this production application's measurement Source and invalidate its key. Core immediately denies further collection and reports disconnected measurement; this does not delete application business records.", true,
    input => request(`${app(input)}?environment=production`, { method: "DELETE", body: {}, lostResponseEffect: "unknown" }));
  register(MCP_APPLICATION_RESULTS_TOOLS[4], z.strictObject({ workspace, operation_id: z.string().uuid(), expected_revision: revision }),
    "Rotate the connected application's server-only installation key with a stable operation ID and current revision. Core returns the new key once, invalidates the prior key and never returns a key on replay. Update the application's secret configuration before relying on new observations.", true,
    input => request(`${app(input)}/rotate?environment=production`, { body: {
      operationId: input.operation_id, expectedRevision: input.expected_revision,
    }, lostResponseEffect: "unknown" }));
  register(MCP_APPLICATION_RESULTS_TOOLS[5], z.strictObject(scope),
    "Read the exact Source revision, selected action labels and observation window frozen for this Broadcast's Results. A null receipt means this Broadcast has not been bound to a Results definition.", false,
    input => request(`${draft(input)}/results-definition?environment=production`, { allowNullReceipt: true }));
  register(MCP_APPLICATION_RESULTS_TOOLS[6], z.strictObject({ ...scope, expected_source_revision: revision.refine(value => value > 0) }),
    "Bind this unsent Broadcast's Results to the application's observed Source revision and selected actions. Core refuses changing a definition after Send. This does not send or record a Return or Action.", true,
    input => request(`${draft(input)}/results-definition?environment=production`, { method: "PUT", body: {
      expectedSourceRevision: input.expected_source_revision,
    }, lostResponseEffect: "unknown" }));
  register(MCP_APPLICATION_RESULTS_TOOLS[7], z.strictObject({ ...scope,
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).nullable().default(null) }),
    "Read Core's authenticated Return, committed Action and payment Results with bounded person evidence and coverage. Preserve pending, unavailable, partial and stale states; none means verified zero. Preserve the opaque cursor; if Core reports a changed Results revision, discard earlier pages and restart the read. Delivery and click counts are available separately in fonte_read_broadcast_results.", false,
    input => request(`${draft(input)}/results?environment=production`
      + (input.cursor === null ? "" : `&cursor=${encodeURIComponent(input.cursor)}`)));
}
