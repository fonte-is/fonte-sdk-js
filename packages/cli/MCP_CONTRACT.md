# Fonte Sequence Authoring MCP V1

`fonte-mcp` is a stdio MCP server for the closed Sequence-definition
authoring surface. It is an authenticated client of Fonte Core; it does not
store, interpret, activate, or execute Sequence state itself.

## Authentication and authority

The server loads the existing hosted CLI configuration and opens the same
browser OAuth flow used by `fonte`. The bearer remains only in process memory
and is sent to Core only in the Authorization header. No browser token, Core
state, recipient data, provider payload, or delivery result is stored by the
MCP process.

Core remains the authority for workspace access, definition validation,
revision checks, operation-key replay, semantic diffs, exported definitions,
and authoring-only timing previews.

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

All inputs name the workspace and environment explicitly. Create and update
also require a caller-owned Sequence ID and operation key. They are
idempotent only through Core's operation-key contract.

The server exposes no resources, generic HTTP proxy, local state, activation,
enrollment, recipient selection, provider payload, send, delivery, billing,
or runtime controls.

## Mutation uncertainty

If a create or update may have reached Core but the response cannot be proven,
the tool returns `outcome: "ambiguous"` and `core_effect: "unknown"`. It never
retries the mutation. Read the known Sequence ID through
`fonte_read_sequence` before deciding any next action.

## Running

Use `fonte-mcp` as an MCP stdio command, for example:

```sh
npx --package @fonte-is/cli fonte-mcp
```

The process opens the system browser only when a tool first needs a Core
session. It does not issue email or create an unattended worker.
