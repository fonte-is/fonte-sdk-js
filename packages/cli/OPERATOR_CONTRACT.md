> Sign-in stores a refresh credential in the selected credential store, bound
> to the issuer, client, scopes and user. Access tokens stay in memory. Fonte
> checks permission for every operation and holds external account credentials.

# Fonte CLI operator V1

## Authority boundary

Operator commands reuse the existing browser OAuth flow and only call bounded
Core routes. The bearer remains in memory and appears only in the Authorization
header. The CLI has no database, provider, queue, provider-credential-storage,
eligibility, billing, consent, sender, freeze, or dispatch authority.

Production requests explicitly bind the production environment, either through
`--environment production` or the saved Send input. Core still
checks workspace membership, role/capability, environment, exact revision,
sender readiness, audience authority, prior use, billing, safety feedback, and
provider capacity. A missing, invalid, stale, or unavailable Core fact stays a
blocker. A lost mutation response has `core_effect: unknown` until the
operation's supported readback or exact replay resolves it.

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

### Review and send a Broadcast

Read the saved draft, request a review of that exact version, and obtain the
customer's approval before sending. Review does not send email:

```text
fonte broadcast review --workspace <slug> --environment production \
  --draft-id <uuid> --expected-version <n> --request-id <review-request-uuid> \
  [--audience-mode reuse_compatible|refresh] [--wait-ms <ms>] --json

fonte broadcast send --send-input '<approved saved Send input JSON>' \
  [--wait-ms <ms>] --json

fonte broadcast operation --workspace <slug> --environment production \
  --draft-id <uuid> --operation-uri <returned-uri> --kind review|send \
  [--wait-ms <ms>] --json

fonte broadcast send recover --workspace <slug> --environment production \
  --draft-id <uuid> --request-id <original-request-uuid> --json
```

A ready review supplies the review ID, digest, draft version and recipient
summary. The client helper `approvedBroadcastSendInput` from
`@fonte-is/cli/broadcast-client` creates the saved input from that review,
its workspace/environment/draft scope, the configured Core origin and a new
Send request UUID. Call it only after the customer approves the review. It
does not obtain approval itself.

The input binds those exact references and `timing: { mode: "now" }`. The
client also accepts an explicitly approved maximum-charge input created by
`boundedDirectBroadcastSendInput`; this carries a spending cap in place of
review references. Core owns audience preparation and validates either form.
Neither form supports a future Send time in this release.

The local CLI saves each review or Send request before submitting it. It
stores the request references and scope, not bearer tokens, message bodies or
recipient lists. After a lost response, `send recover` replays the original
saved request with the same request ID and material. It can recover a review
request as well as a Send request. Do not create a new request ID to recover
an uncertain Send. Changed material under a saved request ID is rejected.

`broadcast operation` reads the returned operation URI only on the configured
Core origin. `--wait-ms` bounds foreground observation; reaching that limit
returns pending with the operation identity. It does not cancel backend work.
Acceptance, execution readiness, provider acceptance and inbox delivery are
different facts. A processing response does not prove that email was sent.

### Existing Send operations and instructions

`broadcast send status` reads the canonical Send operation by draft ID with
GET only. It has no watch mode; use `broadcast operation --wait-ms` for bounded
observation of a returned operation URI. `replace-schedule`, `cancel` and
`increase-limit` remain available for compatible existing instructions.
Replacement and cancellation require the current instruction generation.
Increasing a limit requires Core's exact
`increase_account_spend_limit` action and current approval generation; the CLI
does not calculate a charge or call a payment service.

`broadcast authorize`, `broadcast send now` and `broadcast send schedule`
refuse new sends with `canonical_send_review_required`. They do not create a
Send or schedule. Use the saved input path above for a new Broadcast.

### Drafts, tests and existing Broadcasts

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
preview, verified-account test and exact-version review for that new draft;
do not reuse a prior draft's readback as evidence for changed material.

Audience selection is either `--all-contacts` or a recipient expression with
one or more explicit `--include-collection` / `--include-import-batch` UUIDs and
optional matching exclude flags. Each side is bounded to 20 unique references.
Labels and import filenames are provenance readback only; they are never
selection identity. Core computes live preview counts; a preview does not
authorize Send or create an immutable recipient snapshot.

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
create no authority. For historical Broadcasts, pause, resume and cancel bind
the exact `control_version` returned by status. For a canonical Send operation,
use the draft ID, operation ID, request ID and current expected generation. A
stale opposing command fails with Core's typed conflict and is never retried.

## Broadcast canary and readback

`broadcast canary` runs for at most ten minutes using the current customer
sign-in and one in-memory bearer. It reads Core's production
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
