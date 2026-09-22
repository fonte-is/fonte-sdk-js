# Fonte Sequence and Broadcast MCP

`fonte-mcp` is a stdio MCP server for closed Sequence authoring and bounded
Broadcast draft, targeting, render, test, and v3 Send surfaces. It is an
authenticated client of Fonte Core; it does not store or execute workflow state
itself.

## Authentication and authority

The server loads the existing hosted CLI configuration and opens the same
browser OAuth flow used by `fonte`. The bearer remains only in process memory
and is sent to Core only in the Authorization header. No browser token, Core
state, recipient data, provider payload, or delivery result is stored by the
MCP process.

Core remains the authority for workspace access, definition validation,
revision checks, operation-key replay, immutable version activation, semantic
diffs, exported definitions, Broadcast draft state, instruction replay,
operation status, approval generations, and execution.

## Admitted tools

The server exposes exactly these tools:

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
- `fonte_update_broadcast_targeting`
- `fonte_render_broadcast_draft`
- `fonte_request_broadcast_test`
- `fonte_read_broadcast_test`
- `fonte_send_broadcast_now`
- `fonte_schedule_broadcast`
- `fonte_read_broadcast_send_operation`
- `fonte_replace_broadcast_schedule`
- `fonte_cancel_broadcast_send`
- `fonte_increase_broadcast_spend_limit`

All inputs name the workspace and environment explicitly. Create, update, and
activate also require a caller-owned Sequence ID and operation key. They are
idempotent only through Core's operation-key contract. Activation additionally
accepts one strict binding object with opaque sender, scope, and renderer
references; Core alone validates its relationship to the persisted revision.

Broadcast draft and targeting tools save exact customer inputs by stable Core
identity without resolving names, counting recipients, or preparing an
audience. Render and verified-account tests are optional separate effects and
are never Send prerequisites. The explicit `fonte_send_broadcast_now` or
`fonte_schedule_broadcast` call is the one customer approval handoff; it
records a durable v3 instruction without a machine-side review, exact count,
quote, payment, preparation, or provider call. Its stable request ID is the
only replay identity.

`fonte_read_broadcast_send_operation` is bounded GET-only observation and
cannot advance work. Missing evidence remains unavailable. Schedule replacement
and cancellation bind the exact instruction generation. The spend-limit tool
requires a separate explicit customer direction, verifies Core's exact
structured required action and generations, applies only the supplied account
minimum through the sanctioned billing mutation, and amends the same operation;
it derives no cost and invokes no payment provider.

The server exposes no resources, generic HTTP proxy, local state, Bridge,
recipient preparation, provider payload, delivery mutation, or generic runtime
controls. Sequence activation records only an immutable Core version/binding;
it does not enroll a subscription episode or create a delivery request.

## Mutation uncertainty

If a create or update may have reached Core but the response cannot be proven,
the tool returns `outcome: "ambiguous"` and `core_effect: "unknown"`. It never
retries the mutation. Read the known Sequence ID through
`fonte_read_sequence` before deciding any next action.

If activation may have reached Core but its response cannot be proven, the tool
also returns `outcome: "ambiguous"` and `core_effect: "unknown"`, without an
automatic retry or a fabricated readback instruction. A draft read cannot
establish whether a particular activated version was recorded.

If a Broadcast mutation may have reached Core but its response cannot be
proven, the tool reports `outcome: "ambiguous"` and `core_effect: "unknown"`.
It neither invents success nor performs a second mutation. A caller may repeat
Send or Schedule only with the exact same Core request ID and unchanged
material, or use the bounded operation readback. Read failures are unavailable
with `core_effect: "none"`.

## Running

Use `fonte-mcp` as an MCP stdio command, for example:

```sh
npx --package @fonte-is/cli fonte-mcp
```

The process opens the system browser only when a tool first needs a Core
session. It does not issue email, prepare recipients, or create an unattended
worker.
