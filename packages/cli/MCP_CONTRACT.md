# Fonte MCP

Fonte provides the public HTTP endpoint at [fonte.is/mcp](https://fonte.is/mcp)
and the local `fonte-mcp` stdio command. Both call Fonte's existing product
operations. Core checks the signed-in person's workspace, environment and
permission for every operation.

## Sign-in and local state

The HTTP endpoint uses the client's registered OAuth sign-in. Each HTTP request
uses that caller's authorization; it has no shared login, local files or saved
workspace selection.

For the local command, run `fonte auth login` first. Tools reuse the stored
sign-in and refresh through the same credential store as the CLI. Access tokens
stay in memory and are sent only in the Authorization header. Tool discovery
does not require login. Local Broadcast requests retain their request identity
and reviewed material in the user's private request store so the original
request can be recovered. The local process does not execute delivery work.

## Tools available through both transports

- `fonte_status`
- `fonte_list_connection_choices`
- `fonte_list_connections`
- `fonte_read_connection`
- `fonte_authorize_connection`
- `fonte_read_connection_authorization`
- `fonte_disconnect_connection`
- `fonte_list_contact_sources`
- `fonte_preview_contact_source`
- `fonte_import_contacts`
- `fonte_read_contact_import`
- `fonte_reconcile_audience`
- `fonte_freeze_audience`
- `fonte_read_contact_import_batch`
- `fonte_prepare_broadcast`
- `fonte_send_broadcast`
- `fonte_read_broadcast_send_operation`
- `fonte_list_workspaces`
- `fonte_list_sequences`
- `fonte_read_sequence`
- `fonte_create_sequence`
- `fonte_update_sequence`
- `fonte_validate_sequence`
- `fonte_diff_sequence`
- `fonte_export_sequence`
- `fonte_simulate_sequence`
- `fonte_activate_sequence`
- `fonte_create_broadcast_draft`
- `fonte_read_broadcast_draft`
- `fonte_update_broadcast_draft`
- `fonte_list_broadcast_senders`
- `fonte_update_broadcast_sender`
- `fonte_update_broadcast_targeting`
- `fonte_render_broadcast_draft`
- `fonte_request_broadcast_test`
- `fonte_read_broadcast_test`
- `fonte_list_campaigns`
- `fonte_read_campaign`
- `fonte_create_campaign`
- `fonte_update_campaign`
- `fonte_read_campaign_command`
- `fonte_list_segments`
- `fonte_read_segment`
- `fonte_create_segment`
- `fonte_update_segment`
- `fonte_set_segment_archived`
- `fonte_read_segment_command`

Connection choices and capabilities come from Fonte. Authorization uses a
returned choice reference and a stable attempt UUID; complete consent through
the returned URL. External account credentials remain in Fonte's custody.
Source discovery and preview use the returned connection and source references.
Contact imports preserve existing protection and permission evidence in
Contacts. Importing does not establish consent or send email. After an uncertain
import, reuse the same source and idempotency key to resume the retained input.

Audience reconciliation observes the exact source and exclusions. Freeze is a
separate mutation requiring that observation's fingerprint and an idempotency
key. A completed import batch and its exact identity hash can also identify a
Fonte audience. Missing coverage remains unavailable; the client does not
calculate eligibility or infer an audience identity from a name or count.

Sequence create, update and activation bind a caller-owned Sequence ID and
operation key. Activation freezes one exact revision and its sender, scope and
render references. It does not enroll a subscriber or send a message.
Campaign and Segment tools manage the existing product metadata and return
Core's revision and command receipts.

Broadcast preparation retains the exact customer request and review references.
`fonte_send_broadcast` requires the approved `send_input` returned by that
journey; it never constructs approval from a count or local estimate. Core owns
sender readiness, eligibility, billing, scheduling and dispatch. Operation
readback observes the same durable request without advancing delivery.

## Additional local tools

- `fonte_recover_broadcast_request`
- `fonte_send_broadcast_now`
- `fonte_schedule_broadcast`
- `fonte_read_legacy_broadcast_send_operation`
- `fonte_replace_broadcast_schedule`
- `fonte_cancel_broadcast_send`
- `fonte_increase_broadcast_spend_limit`
- `fonte_prepare_broadcast_html_file`
- `fonte_revise_broadcast_html_file`

HTML-file tools read the explicitly selected local file. Request recovery uses
the original private request store. The legacy Send instruction tools remain
available locally for existing callers. Their mutations bind Core's exact
instruction and approval generations; the spend-limit operation requires a
separate explicit customer direction. They cannot invent billing authority or
call a payment service directly.

## Additional HTTP tools

- `fonte_list_broadcast_options`
- `fonte_create_broadcast_recipient_set`
- `fonte_read_broadcast_recipient_set`
- `fonte_read_broadcast_results`
- `fonte_read_broadcast_recipients`
- `fonte_read_sender_domains`
- `fonte_migrate_sender_domain`
- `fonte_reconcile_sender_domain`
- `fonte_read_broadcast_control`
- `fonte_cancel_broadcast`
- `fonte_list_links`
- `fonte_create_link`
- `fonte_read_link`
- `fonte_create_link_copy`
- `fonte_read_link_metrics`
- `fonte_read_link_clicks`
- `fonte_read_link_lifecycle`
- `fonte_read_broadcast_status`
- `fonte_read_application`
- `fonte_connect_application`
- `fonte_save_application_settings`
- `fonte_disconnect_application`
- `fonte_rotate_application_key`
- `fonte_read_broadcast_results_definition`
- `fonte_bind_broadcast_results`
- `fonte_read_broadcast_outcomes`

HTTP Broadcast recipient-set intake accepts bounded inline CSV and requires
explicit permission confirmation for the exact recipients. It creates only a
Broadcast-scoped set, adds nothing to Everyone and sends no email. Domain
migration and reconciliation use the workspace domain owner's revision and
readiness checks. Cancellation ends remaining work through the stored
Broadcast's control generation; it preserves delivery and uncertain history.

Fonte Links report issued placements, requests, confirmed visits and recorded
outcomes. A forwarded placement preserves its original touch; browser evidence
alone does not identify a signed-in person. Application tools connect a
production origin, select successful actions and manage explicit measurement
grants. An installation key is returned once by connect or rotation and belongs
only in the application's server-side secret configuration. Settings changes
preserve connection-owned action mappings and reject conflicts.

Results definitions bind an unsent Broadcast to the observed application Source
revision and selected actions. Results reads preserve authenticated Return,
committed Action and authoritative payment evidence from the existing Results
owner. Pending, unavailable, partial and stale measurements remain distinct
from verified zero. Preserve opaque cursors; restart a paged read when Core
reports a changed Results revision. Delivery and per-link click reporting are
separate from application outcomes.

## Uncertain responses

A mutation that may have reached Core returns `outcome: "ambiguous"` and
`core_effect: "unknown"`. The client does not automatically resubmit it. Read
the known operation or resource before deciding what happens next. Repeat a
request only where its operation explicitly supports the same stable identity
and unchanged input. A draft read cannot prove Sequence activation, and a
Source read cannot recover an installation key that was returned once.

Neither transport exposes a generic HTTP proxy, external credential input,
local eligibility engine or delivery worker. There are no MCP resources.

## Running the local server

```sh
npx --package @fonte-is/cli fonte-mcp
```
