# Fonte CLI operator V1

## Implemented slice

V1 adds only the current fixed sandbox broadcast test queue and readback:

```text
fonte broadcast test send --workspace <slug> --environment sandbox \
  --draft-id <uuid> --revision <n> --idempotency-key <key> [--json]
fonte broadcast test status --workspace <slug> --environment sandbox \
  --test-id <uuid> [--watch] [--json]
```

Both commands use the existing browser OAuth and hosted/local discovery seam.
The bearer stays in memory and appears only in the Authorization header. Core
selects the signed-in account's verified recipient and accepts only its fixed
CLI sandbox proof draft. The queue command binds the exact draft revision and
idempotency key. Status output contains sanitized accepted, refused, unknown,
and accepted-usage counts; it never contains the recipient address, provider
message fields, message body, bearer, cookie, contact, or provider payload.

The exported `@fonte-is/cli/operator-client` boundary accepts an in-memory
bearer and exposes only these two current Core operations. It has no database,
provider, credential-storage, or authority-synthesis capability.

## Generic unsupported authority

Current Core does not expose the required operator authority for draft
create/update, audience attach/preview, preflight, exact production
authorization, idempotent pause/resume/cancel, or provenance-preserving
duplication. All those broadcast declarations return the same
`unsupported_authority` receipt before OAuth, file access, or network access.

Bridge declarations are limited to these names:

```text
fonte bridge observe <provider> ...
fonte bridge status ...
fonte bridge diff ...
fonte bridge placement-plan ...
fonte bridge copy ...
fonte bridge reconcile ...
```

They also return the same generic receipt. V1 defines no Bridge endpoint,
client method, adapter, renderer, journal, fingerprint implementation, copy
path, delete path, or provider mutation. A future Core-owned contract must
first prove read-only complete observation, exact connection/snapshot/plan
binding, idempotency, sanitized aggregate copy counts, and reconciliation.

## Smallest later MCP cut

An MCP wrapper may reuse the exported in-memory operator client for sandbox
test queue/readback. Queueing is approval-gated; readback is a resource. All
production broadcast and Bridge tools remain disabled until Core exposes their
authority. There is no generic HTTP, provider credential, provider delete, or
provider mutation tool.
