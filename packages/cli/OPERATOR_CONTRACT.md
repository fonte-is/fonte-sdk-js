> Human CLI identity may persist only as a refresh credential in
> native OS custody, bound to the exact issuer/client/scopes/user. Each operation
> still obtains current Core authority. Provider credentials remain Core-owned.

# Fonte CLI operator V1

## Authority boundary

Operator commands reuse the existing browser OAuth flow and only call bounded
Core routes. The bearer remains in memory and appears only in the Authorization
header. The CLI has no database, provider, queue, provider-credential-storage,
eligibility, billing, consent, sender, freeze, or dispatch authority.

Every production command requires `--environment production`. Core still
checks workspace membership, role/capability, environment, exact revision,
sender readiness, audience authority, prior use, billing, safety feedback, and
provider capacity. A missing, invalid, stale, or unavailable Core fact stays a
blocker. A lost mutation response has `core_effect: unknown` until an explicit
authoritative read command resolves it.

## Sequence authoring and activation

Sequence commands use the same stored customer session and Core workspace-access path,
but they support either `sandbox` or `production` because they are definition
authoring operations, not provider effects:

```text
fonte sequence list --workspace <slug> --environment <sandbox|production>

fonte sequence read --workspace <slug> --environment <sandbox|production> \
  --sequence-id <id>

fonte sequence create --workspace <slug> --environment <sandbox|production> \
  --sequence-id <caller-owned-id> --operation-key <key> \
  --definition <json-object>

fonte sequence update --workspace <slug> --environment <sandbox|production> \
  --sequence-id <id> --expected-revision <n> --operation-key <key> \
  --definition <json-object>

fonte sequence activate --workspace <slug> --environment <sandbox|production> \
  --sequence-id <id> --expected-revision <n> --operation-key <key> \
  --binding <json-object>

fonte sequence validate --workspace <slug> --environment <sandbox|production> \
  --definition <json-object>

fonte sequence diff --workspace <slug> --environment <sandbox|production> \
  --sequence-id <id> [--base-revision <n>] --definition <json-object>

fonte sequence export --workspace <slug> --environment <sandbox|production> \
  --sequence-id <id>

fonte sequence simulate --workspace <slug> --environment <sandbox|production> \
  --sequence-id <id> --entered-at-ms <epoch-ms> \
  [--assumed-accepted-at-ms <json-object>]
```

The CLI forwards the definition JSON unchanged to Core and retains no Sequence
state. Create and update carry Core's `operationKey`; they also require a
caller-owned Sequence ID so an ambiguous response has one safe readback. A
lost mutation response remains `core_effect: unknown`, includes the exact
`fonte sequence read ... --json` command, and has `retry_mutation: false`.
Do not retry the mutation before that read. Core alone resolves operation-key
replay, changed-material conflict, revision conflict, and the persisted
definition.

Activation submits one exact Core draft revision and a structurally checked but
semantically opaque binding JSON object with exactly `senderId`, `scope`, and
`messageRenderReferences`. Core alone validates that it is a complete Sequence,
that the renderer references match its Send steps, and records the immutable
activated version. It creates no subscription entry, recipient, provider
request, delivery outcome, billing fact, or runtime control. An activation
response that is lost or malformed remains `core_effect: "unknown"`; the CLI
does not retry it and does not suggest draft readback because that route cannot
prove whether an activated version was recorded.

Validate, diff, export, and simulate are definition/preview operations only.
They do not activate a Sequence, enroll a subscription episode, create a
message occurrence, submit provider work, or claim a delivery outcome. The
separate `activate` command only records the Core version and binding; it does
not perform any of those runtime effects.

## Production journey

### Broadcast v3 Fast Path

For a new v3 Send, the explicit customer Send or Schedule direction is the
single human-approval handoff:

```text
fonte broadcast send now --workspace <slug> --environment production \
  --draft-id <uuid> --expected-version <n> --request-id <uuid>

fonte broadcast send schedule --workspace <slug> --environment production \
  --draft-id <uuid> --expected-version <n> \
  --not-before <canonical-iso-instant> --request-id <uuid>

fonte broadcast send status --workspace <slug> --environment production \
  --draft-id <uuid> [--watch]

fonte broadcast send replace-schedule --workspace <slug> \
  --environment production --draft-id <uuid> \
  --expected-instruction-generation <n> --expected-version <n> \
  --not-before <canonical-iso-instant> --request-id <uuid>

fonte broadcast send cancel --workspace <slug> --environment production \
  --draft-id <uuid> --expected-instruction-generation <n> \
  --request-id <uuid>

fonte broadcast send increase-limit --workspace <slug> \
  --environment production --draft-id <uuid> \
  --expected-instruction-generation <n> \
  --expected-approval-generation <n> --request-id <uuid>
```

Send and Schedule submit exactly one digest-free v3 instruction for the saved
draft version and return the durable Queued or Scheduled operation. The client
does not review, prepare, resolve, count, quote, reserve, pay, authorize, or
dispatch before acceptance. The request ID is both the body replay identity
and the HTTP idempotency key. A lost mutation response keeps
`core_effect: unknown`; the same request may be retried with the exact same
request ID and material, while the bounded operation GET provides independent
readback by draft identity.

Status and status watch are GET-only and cannot advance the operation. Missing
evidence remains unavailable, never zero or complete. The human lifecycle is
Queued, Scheduled, Preparing, Sending, Complete, Cancelled, or Action required;
the CLI folds internal authorization, packaging, and pending activation into
Preparing unless diagnostic detail was explicitly requested.

Schedule replacement and cancellation are generation-fenced against Core's
current instruction. The spend-limit command is allowed only for the exact
structured `increase_account_spend_limit` action returned by the same
operation. It re-reads that action, verifies instruction and approval
generations, submits only Core's `minimumMaximumMinor` to the existing account
spending-cap mutation, then amends approval on the same operation. It derives
no cost, reconstructs no balance, reserves nothing, and never calls a payment
provider directly.

The preflight, authorize, broadcast-ID status, and broadcast-ID control
commands below remain as the legacy v1/v2 compatibility surface. They are not
part of v3 acceptance and must not be inserted before a v3 Send or Schedule.

### Legacy v1/v2 compatibility

```text
fonte broadcast marketing-settings read --workspace <slug> \
  --environment <sandbox|production>

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
  --idempotency-key <key> --text-body <text> --html-body <html>

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

fonte broadcast canary --workspace <slug> --environment production \
  --broadcast-id <uuid> --release-ceiling <n> --idempotency-key <key>

fonte broadcast pause|resume|cancel --workspace <slug> \
  --environment production --broadcast-id <uuid> \
  --expected-control-version <n>

fonte broadcast result --workspace <slug> --environment production \
  --broadcast-id <uuid>
```

Marketing-settings read is one authenticated Core GET with no request body or
retry. It succeeds in exactly one of two coupled states: configured returns the
exact workspace ID and environment with nonempty normalized `postalAddress`
and canonical `updatedAt`; not configured returns the exact workspace ID and
environment with both `postalAddress: null` and `updatedAt: null`. Missing,
extra, partial-null, blank, malformed, or environment-mismatched readback fails
closed with no Core effect.

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
signed-in account's verified email. Both MIME bodies are required explicitly;
Core requires `--html-body` to equal the persisted draft body and commits the
separate `--text-body` in the same immutable send authorization. Neither body
is derived, substituted, or retained as local CLI truth.

Before the one permitted test-send mutation, read the draft and freeze its
`latest_test_id` baseline. If the mutation response is lost, do not repeat the
mutation. Read the draft again and proceed to `broadcast test status` only when
Core returns one exact new `latest_test_id` and the operation had exclusive
test-send authority; an unchanged or otherwise ambiguous ID remains unknown.
The terminal accepted receipt includes Core's durably reconciled provider
MessageId plus accepted usage quantity and usage-record count. Processing,
refused, or unknown outcomes keep the MessageId null and never authorize a
mutation retry. Test and progress watches poll existing read routes; they
create no authority. Pause, resume, and cancel map only to
Core's broadcast-scoped state-idempotent control operation. Each command binds
the exact `control_version` returned by an authoritative status read. A stale
opposing command fails with Core's typed conflict and is never retried.

## Broadcast canary and readback

`broadcast canary` is one declared ten-minute operation under one Authorization
Code + S256 PKCE grant and one in-memory bearer. It reads Core's production
progress first and proceeds only for the requested workspace and broadcast when
the baseline is fresh and its released-recipient accounting is exact. Historical
refused, unknown, and cancelled counts are frozen, not erased. A paused
broadcast is resumed once with the same bearer; pre-existing pending or claimed
work must then settle without increasing any frozen safety count. The operator
supplies an exact cumulative release ceiling; the CLI sends Core only the
difference between that ceiling and the settled released count, under Core's
existing idempotency key. It reads progress without mutation retries, requires
that exact new delta to become newly accepted, preserves the historical
non-accepted offset, and pauses while the broadcast remains open. A fresh Core
`terminal` receipt at the exact accepted ceiling, with exact recipient accounting
and no held, pending, claimed, or remaining work, completes without an additional
control mutation. An already-terminal baseline reports no Core effect. Terminal
success retains the distinct receipt reason when new cancellations occurred.
After resume begins, the first refused,
unknown, cancelled, stale, or unavailable observation also causes one immediate
pause attempt. The terminal receipt contains only the frozen operation ID,
sanitized progress, completed steps, and the ended in-memory authorization
lifetime. Cancellation, expiry, failed OAuth state, or a distinct invocation
never inherits that bearer.

When a canary or control mutation response is ambiguous, the receipt keeps
`core_effect: "unknown"` and adds a `next_action` containing the exact
`fonte broadcast status ... --json` readback plus `retry_mutation: false`.
The human receipt renders the same authoritative command and explicitly says
not to retry the mutation. Status readback is the only sanctioned next step;
an absent response never becomes evidence that the mutation had no effect.

When Core reports prior audience use, preflight exposes the exact non-sensitive
audience identity. `--acknowledge-audience-reuse` sends Core's bounded v1
override and waives only that warning. It does not waive any other authority.

Final result output preserves requested, eligible, provider terminal/pending,
billing availability, communication purpose, recipient expression, source
collection/import provenance, frozen audience counts, and bounded prior-use
evidence. Legacy missing audience evidence remains null, never zero.

## Connected contacts and audiences

Connections, contact imports and audience preparation use the same Fonte
operations through the operator client, CLI and MCP. Choose a connection from
Fonte's current choices; use the references returned by Fonte in later calls.
The client does not contain a fixed catalog of external services or accept
external account credentials.

`fonte connections choices` lists available choices and requested permissions.
`list` and `read` show existing connections. `authorize` starts an attempt
using a choice reference, a caller-owned attempt UUID and a display name. To
reconnect, also supply the existing connection reference and expected credential
version. `authorization` reads that attempt; `disconnect` checks the expected
credential version. All commands require `--workspace` and `--environment`.
Complete consent through the returned authorization URL. Tokens remain in
Fonte's custody.

`fonte contacts sources` lists contact sources for a connection reference.
`preview` reads one source reference and reports its current coverage,
protection and unknown counts. `import` takes that source reference and an
idempotency key; `import-status` reads the returned operation reference.
Importing contacts does not establish permission to email them or send a
Broadcast. Fonte preserves existing protection and permission evidence, and
imports into the ordinary Contacts and audience selection path.

Reuse the original request key after an uncertain import. Fonte retains the
original input before acknowledging the operation, so a resumed import does
not substitute a changed external source. A different source with the same key
is a conflict. Incomplete source observation fails closed.

Advanced audience preparation is explicit:

```text
fonte audience reconcile --workspace <slug> --environment <sandbox|production> \
  --source-ref <ref> [--exclude-source-ref <ref>] [--json]

fonte audience freeze --workspace <slug> --environment <sandbox|production> \
  --source-ref <ref> [--exclude-source-ref <ref>] \
  --fingerprint <sha256> --idempotency-key <key> [--json]
```

Reconcile observes the exact source and exclusions without importing or
sending. Its receipt preserves the observation fingerprint, source, excluded,
protected, unknown and final counts, and unavailable-input reasons. Unavailable
counts remain null. The client discards contact rows from this receipt.
Freeze repeats the same source and exclusions with that fingerprint and a new
idempotency key. It creates an immutable Fonte audience through the existing
freeze operation. Import and freeze are separate operations. Neither mutates
an external collection or sends email.

For a completed Fonte import, replace `--source-ref` with
`--contact-import-batch-id <uuid> --identity-set-sha256 <sha256>`.
`fonte bridge import status --workspace <slug> --environment <sandbox|production>
--contact-import-batch-id <uuid> [--json]` reads those exact values from Fonte.
The equivalent client method is `readContactImportStatus`. It returns only a
completed batch and its canonical identity hash. Pending, failed, incomplete,
unavailable or malformed readback remains blocked with no hash. The client
never calculates an audience identity from a file, count or name.

Missing broadcast declarations return `unsupported_authority` before sign-in
or network access. The CLI has no generic HTTP command, external credential
input or local eligibility engine. The MCP tools and their individual effects
are listed in `MCP_CONTRACT.md`.
