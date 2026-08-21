# Fonte CLI operator V1

## Authority boundary

Operator commands reuse the existing browser OAuth flow and only call bounded
Core routes. The bearer remains in memory and appears only in the Authorization
header. The CLI has no database, provider, queue, AWS, credential-storage,
eligibility, billing, consent, sender, freeze, or dispatch authority.

Every production command requires `--environment production`. Core still
checks workspace membership, role/capability, environment, exact revision,
sender readiness, audience authority, prior use, billing, safety feedback, and
provider capacity. A missing, invalid, stale, or unavailable Core fact stays a
blocker. A lost mutation response has `core_effect: unknown` until an explicit
authoritative read command resolves it.

## Production journey

```text
fonte broadcast audience options --workspace <slug> --environment production

fonte broadcast draft create --workspace <slug> --environment production \
  --idempotency-key <uuid> --title <title> --subject <subject> --body <html> \
  --sender-profile-id <id> --communication-purpose-id <uuid> \
  (--all-contacts | --include-collection <uuid> | --include-import-batch <uuid>)

fonte broadcast draft read --workspace <slug> --environment production \
  --draft-id <uuid>

fonte broadcast audience preview --workspace <slug> --environment production \
  --draft-id <uuid>

fonte broadcast test send --workspace <slug> --environment production \
  --draft-id <uuid> --revision <n> --postal-address <address> \
  --idempotency-key <key>

fonte broadcast test status --workspace <slug> --environment production \
  --draft-id <uuid> --test-id <uuid> [--watch]

fonte broadcast preflight --workspace <slug> --environment production \
  --draft-id <uuid> --expected-version <n> --postal-address <address> \
  [--acknowledge-audience-reuse <sha256:identity>]

fonte broadcast authorize --workspace <slug> --environment production \
  --draft-id <uuid> --revision <n> --postal-address <address> \
  --idempotency-key <key> \
  [--acknowledge-audience-reuse <sha256:identity>]

fonte broadcast status --workspace <slug> --environment production \
  --broadcast-id <uuid> [--watch]

fonte broadcast pause|resume|cancel --workspace <slug> \
  --environment production --broadcast-id <uuid>

fonte broadcast result --workspace <slug> --environment production \
  --broadcast-id <uuid>
```

Draft creation uses the UUID idempotency key as Core's stable draft identity.
An exact replay is a no-op; changed material under the same key is a conflict.
The body is Core's current persisted HTML/body field and is never inferred from
a template or browser state. Optional `--preheader` and `--reply-to` are passed
as entered.

## Replacement-draft recovery

Core intentionally denies CLI OAuth `PUT` and `PATCH` draft mutations. If title,
subject, body, sender, purpose, or audience inputs change, create a replacement
draft with a new UUID idempotency key. Restart Core's authoritative audience
preview, verified-account test, and exact-revision preflight for that new draft;
do not reuse a prior draft's readback as evidence for changed material.

Audience selection is either `--all-contacts` or a recipient expression with
one or more explicit `--include-collection` / `--include-import-batch` UUIDs and
optional matching exclude flags. Each side is bounded to 20 unique references.
Labels and import filenames are provenance readback only; they are never
selection identity. Core computes live preview counts and freezes the exact
immutable recipient snapshot only during authorization.

The production test command cannot accept a recipient. Core resolves only the
signed-in account's verified email. Test and progress watches poll existing
read routes; they create no authority. Pause, resume, and cancel map only to
Core's broadcast-scoped state-idempotent control operation.

When Core reports prior audience use, preflight exposes the exact non-sensitive
audience identity. `--acknowledge-audience-reuse` sends Core's bounded v1
override and waives only that warning. It does not waive any other authority.

Final result output preserves requested, eligible, provider terminal/pending,
billing availability, communication purpose, recipient expression, source
collection/import provenance, frozen audience counts, and bounded prior-use
evidence. Legacy missing audience evidence remains null, never zero.

## Other implemented commands

The fixed sandbox canary and Resend Bridge commands remain unchanged. Sandbox
test status and production test status use different admitted Core routes.
Resend preview remains observation-only; copy remains a separate
fingerprint-bound action. Neither Bridge command mutates provider state.

All other broadcast or Bridge declarations return `unsupported_authority`
before OAuth or network access. There is no generic HTTP command, provider
credential command, browser UI fallback, generic segment language, local
eligibility engine, automatic retry after an ambiguous mutation, or MCP layer.
