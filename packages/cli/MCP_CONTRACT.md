# Fonte Sequence Authoring and Activation MCP V1

`fonte-mcp` is a stdio MCP server for the closed Sequence-definition authoring
and activation surface. It is an authenticated client of Fonte Core; it does
not store, interpret, enroll, or execute Sequence state itself.

## Authentication and authority

The server loads the existing hosted CLI configuration and opens the same
browser OAuth flow used by `fonte`. The bearer remains only in process memory
and is sent to Core only in the Authorization header. No browser token, Core
state, recipient data, provider payload, or delivery result is stored by the
MCP process.

Core remains the authority for workspace access, definition validation,
revision checks, operation-key replay, immutable version activation, semantic
diffs, exported definitions, and authoring-only timing previews.

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

All inputs name the workspace and environment explicitly. Create, update, and
activate also require a caller-owned Sequence ID and operation key. They are
idempotent only through Core's operation-key contract. Activation additionally
accepts one strict binding object with opaque sender, scope, and renderer
references; Core alone validates its relationship to the persisted revision.

The server exposes no resources, generic HTTP proxy, local state, enrollment,
recipient selection, provider payload, send, delivery, billing, or runtime
controls. Activation records only an immutable Core version/binding; it does
not enroll a subscription episode or create a delivery request.

## Mutation uncertainty

If a create or update may have reached Core but the response cannot be proven,
the tool returns `outcome: "ambiguous"` and `core_effect: "unknown"`. It never
retries the mutation. Read the known Sequence ID through
`fonte_read_sequence` before deciding any next action.

If activation may have reached Core but its response cannot be proven, the tool
also returns `outcome: "ambiguous"` and `core_effect: "unknown"`, without an
automatic retry or a fabricated readback instruction. A draft read cannot
establish whether a particular activated version was recorded.

## Running

Use `fonte-mcp` as an MCP stdio command, for example:

```sh
npx --package @fonte-is/cli fonte-mcp
```

The process opens the system browser only when a tool first needs a Core
session. It does not issue email or create an unattended worker.
