# Fonte CLI operator V1

## Implemented slice

V1 exposes the current fixed sandbox broadcast test queue/readback and the
Core-owned Resend Bridge segment preview/copy routes:

```text
fonte broadcast test send --workspace <slug> --environment sandbox \
  --draft-id <uuid> --revision <n> --idempotency-key <key> [--json]
fonte broadcast test status --workspace <slug> --environment sandbox \
  --test-id <uuid> [--watch] [--json]
fonte bridge observe resend --workspace <slug> \
  --environment <sandbox|production> --segment-id <provider-id> [--json]
fonte bridge copy resend --workspace <slug> \
  --environment <sandbox|production> --segment-id <provider-id> \
  --fingerprint <64-lower-hex> --idempotency-key <key> [--json]
```

These commands use the existing browser OAuth and hosted/local discovery seam.
The bearer stays in memory and appears only in the Authorization header. Core
selects the signed-in account's verified recipient and accepts only its fixed
CLI sandbox proof draft. The queue command binds the exact draft revision and
idempotency key. Status output contains sanitized accepted, refused, unknown,
and accepted-usage counts; it never contains the recipient address, provider
message fields, message body, bearer, cookie, contact, or provider payload.

The exported `@fonte-is/cli/operator-client` boundary accepts an in-memory
bearer and exposes only these four current Core operations. It has no database,
provider adapter, credential-storage, or authority-synthesis capability.

`bridge observe resend` maps only to Core's read-only Resend segment preview.
It sends `{}` and prints a sanitized observation receipt: connection and
segment identity, observation time and fingerprint, pagination completeness,
and aggregate observed/protected/unknown counts. It discards unknown response
fields and never prints contacts, addresses, provider payloads, credentials, or
message bodies.

`bridge copy resend` is always a separate operator action. It requires the
exact lower-case SHA-256 fingerprint printed by preview and an idempotency key
of at most 100 characters. Core re-observes the provider, rejects changed or
incomplete observations, and owns the Fonte contact import. The CLI prints only
the sanitized import batch identity, whether Core created it, and aggregate
reconciliation counts. It discards the echoed idempotency key and source
checksum. Neither Bridge command deletes or mutates provider data. There is no
implicit copy after preview.

## Current Core bedrock

The admitted Resend Bridge route currently calls workspace authorization
without allowing the configured CLI OAuth client ID. A bearer issued through
the sanctioned CLI browser flow therefore receives Core's exact
`403 oauth_client_route_denied` response until Core admits that client on this
route. The CLI surfaces the blocker and does not substitute another bearer or
bypass workspace authorization.

Core also leaves the Bridge service disabled unless its production AWS secret
custody, connection identity, and segment identity are configured. The CLI
surfaces Core's exact `503 resend_bridge_unavailable` result as a credential
custody blocker; it never accepts, stores, or provisions a Resend credential.

## Generic unsupported authority

Current Core does not expose the required operator authority for draft
create/update, audience attach/preview, preflight, exact production
authorization, idempotent pause/resume/cancel, or provenance-preserving
duplication. All those broadcast declarations return the same
`unsupported_authority` receipt before OAuth, file access, or network access.

All non-Resend or unexposed Bridge declarations remain generic unsupported:

```text
fonte bridge observe <provider-other-than-resend> ...
fonte bridge status ...
fonte bridge diff ...
fonte bridge placement-plan ...
fonte bridge copy <provider-other-than-resend> ...
fonte bridge reconcile ...
```

They return the same generic receipt. V1 defines no generic connector, local
observation/fingerprint implementation, journal, plan, reconciliation poller,
delete path, sync, watch, scheduler, Kit adapter, provider credential command,
or provider mutation command.

## Smallest later MCP cut

An MCP wrapper may reuse the exported in-memory operator client. Sandbox queue
and Resend copy are explicit approval-gated tools; sandbox status and Resend
preview are resources/read-only tools. All production broadcast and other
Bridge tools remain disabled. There is no generic HTTP, provider credential,
provider delete, or provider mutation tool.
