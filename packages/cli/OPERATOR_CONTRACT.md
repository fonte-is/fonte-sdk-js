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
retry. It returns only the exact workspace ID, environment, nonempty normalized
postal address, and update time; missing, extra, blank, malformed, or
environment-mismatched readback fails closed with no Core effect.

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

## Candidate-scoped Resend evidence

The installed binary exposes five fixed JSON-only commands:

```text
fonte provider-evidence resend start ... --candidates-file <json-file> --json
fonte provider-evidence resend read ... --operation-id <uuid> --json
fonte provider-evidence resend advance ... --operation-id <uuid> --expected-request-number <n> --json
fonte provider-evidence resend seal ... --operation-id <uuid> --generation-id <uuid> --json
fonte provider-evidence resend generation read ... --generation-id <uuid> --json
```

Every command binds workspace, environment, connection ID, selector ID,
selector-generation ID, artifact SHA-256, identity-set SHA-256, candidate
count, and candidate-manifest SHA-256. Start additionally binds operation ID,
schema and normalization versions, the tenant-HMAC fingerprint version,
identity-custody key/version, and a strict JSON object containing only the
candidate array. Candidate rows and provider record IDs never enter arguments,
help, stdout, stderr, or receipts.

Read the operation before each advance. Advance accepts exactly the
`next_request_number` from that aggregate read and issues one logical request;
the CLI adds no retry loop. A lost start, advance, or seal response remains
unknown until same-identity operation or generation readback resolves it.
The structured ambiguous receipt preserves `core_effect: "unknown"`, sets
`retry_mutation: false`, and gives the complete guarded read or generation-read
command in `next_action`. Human rendering prints that same command, prints
`Retry mutation: false`, and says not to retry. For a frozen-CSV start, Core
derives the candidate-manifest hash. If that start response is lost before the
hash is observed, the CLI cannot truthfully construct the strict read command;
`next_action` is therefore a typed `candidate_manifest_unavailable` stop with
`retry_mutation: false`, never a guessed guard or repeated start.
Core alone owns the stored Resend credential, cursor, rate/retry/throttle
accounting, and candidate-scoped GET construction. The commands grant neither
provider nor contact mutation authority and emit only Core's aggregate
operation or generation receipt.

## Fresh rotation partition journey

The four fixed commands are one closed, Core-authoritative journey:

```text
fonte bridge rotation start <exact iteration and evidence flags> [--json]
fonte bridge rotation read --workspace <slug> --environment <environment> \
  --iteration-id <uuid> [--json]
fonte bridge rotation advance --workspace <slug> --environment <environment> \
  --iteration-id <uuid> --expected-page-number <latest-read-value> [--json]
fonte bridge rotation seal <exact iteration and generation flags> [--json]
```

Run `start`, then `read`. While the read receipt supplies another population or
broadcast page, run exactly one `advance` with its `nextPageNumber`, then
`read` again. When Core reports the evidence ready, run `seal`, followed by a
final `read`. Start, advance, and seal are never automatically retried. An
ambiguous response preserves `core_effect: "unknown"`, includes the exact
`rotation read` command with `retry_mutation: false`, and plainly says not to
retry the mutation.

Core—not the CLI—creates an exhaustive disjoint partition whose four private
sealed selector sets have union equality with the fresh live population root:

- `E` (eligible now): current unsubscribe/protection checks pass; the named
  qualifying broadcast has a positive accepted, delivered, opened, or clicked
  outcome; provider `created_at` is known; portability is complete; and Fonte
  custody is either eligible (`retirement_evidence_complete`) or absent
  (`canonical_import_not_completed`).
- `W` (warm first): the identity was not a recipient of the named qualifying
  broadcast (`no_message_history`) and must remain in Resend for warming.
- `X` (excluded): current provider unsubscribe, bounce, complaint, suppression,
  or protected/ineligible Fonte custody applies.
- `U` (unknown): Fonte custody is unknown, qualifying-broadcast evidence is
  unknown or refused, provider `created_at` is missing, or portability evidence
  is unknown. Any nonzero `U` blocks effects and the outgoing selector.

Human and JSON receipts expose only aggregate progress, category/reason counts,
private selector/generation identities, and union/partition checksums. They do
not expose contact rows, email addresses, provider record IDs, or credentials.
Successful and blocked partition receipts are both human-renderable; an
already-attempted Core operation never becomes an output-format failure.

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
non-accepted offset, and pauses. After resume begins, the first refused,
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

## Other implemented commands

The fixed sandbox canary and Resend Bridge copy commands remain unchanged.
Sandbox test status and production test status use different admitted Core
routes. Resend preview remains observation-only; copy remains a separate
fingerprint-bound action. Neither command mutates provider state.

Provider connections are established through Core-owned native OAuth:

```text
fonte bridge connections list resend|kit --workspace <slug> \
  --environment <sandbox|production>

fonte bridge connections connect resend|kit --workspace <slug> \
  --environment <sandbox|production> --display-name <name>

fonte bridge connections reconnect resend|kit --workspace <slug> \
  --environment <sandbox|production> --connection-id <uuid> \
  --display-name <name> --expected-credential-version <n>
```

Connect and reconnect start a short-lived Core attempt, open or return the
provider authorization URL, and poll sanitized status after the browser opens.
The user enters credentials only on Resend or Kit's consent page. Provider
access and refresh tokens never enter CLI input, arguments, environment,
output, logs, files, or receipts. Resend's provider grant is `full_access`
because Resend requires it for non-send routes even though Fonte's Bridge use
is read-only. A lost or unfinished completion remains unknown until Core
readback. Kit keeps the same typed command surface but fails closed as
`provider_oauth_unavailable` until its exact application and scope
configuration is admitted.

Core's provider-audience boundary also supports this CLI-only operator journey:

```text
fonte bridge collections resend|kit --workspace <slug> \
  --environment <sandbox|production> --connection-id <uuid>

fonte bridge import status --workspace <slug> \
  --environment <sandbox|production> --contact-import-batch-id <uuid>

fonte bridge reconcile --workspace <slug> \
  --environment <sandbox|production> \
  (--source-provider <resend|kit> --source-connection-id <uuid> \
   --source-collection-id <id> --source-display-name <name> | \
   --source-import-batch-id <uuid> --source-identity-set-sha256 <sha256>) \
  --max-age-seconds <1..86400> \
  [--exclude-provider <resend|kit> --exclude-connection-id <uuid> \
   --exclude-collection-id <id> --exclude-display-name <name>]...

fonte bridge freeze <the exact reconcile source, exclusions, and max-age flags> \
  --fingerprint <64-lower-hex> --idempotency-key <key>
```

Collection discovery is a read through Core's credential custody. Reconcile is
an authoritative, observation-only Core operation. Its CLI receipt contains
only source/exclusion provenance, freshness/coverage, unavailable-input reasons,
aggregate source/excluded/protected/unknown/final counts, and the exact
observation fingerprint; contact rows and provider payloads are discarded.

Contact-import status projects only a terminal completed batch UUID and Core's
canonical identity-set SHA-256. Supply those exact two values as
`--source-import-batch-id` and `--source-identity-set-sha256`; the CLI never
hashes contacts or infers identity from a file or count. Pending, failed,
incomplete, unavailable, or malformed readback remains blocked with no hash.

The source is either the unchanged provider collection reference or one exact
Core-owned immutable import-batch UUID plus its canonical identity-set SHA-256;
the forms cannot be combined. Up to 24 provider exclusions are forwarded in
the operator's exact order without name matching or omission.

Freeze is a separate explicit mutation. It repeats the exact source and
exclusions, requires the reconciliation fingerprint and an idempotency key,
and returns Core's immutable frozen-audience/import-batch reference. A lost
freeze response is `core_effect: unknown`; the CLI never infers success or
reconciles eligibility itself. None of these commands deletes or mutates a
provider collection.

Certificate-bound retirement and refill are two distinct placement
applications. The retirement application carries the exact Core-owned
certificate and an empty incoming cohort. Its terminal `placement progress`
receipt supplies the settled `provider_population_count` (`P`). Only after that
terminal readback may the operator freeze the freshly requalified incoming
prefix of `147000 - P` and submit a refill-only application. That file carries
the expected workspace UUID as `workspaceId`, an empty outgoing cohort, and no
`retirementCertificate`; the CLI uses `workspaceId` only to verify Core's
aggregate receipt and never forwards it. Both applications have distinct
durable idempotency keys. A partial, unknown, mismatched, or unavailable
retirement readback grants no refill authority.

All other broadcast or Bridge declarations return `unsupported_authority`
before OAuth or network access. There is no generic HTTP command, provider
credential input, browser UI fallback, generic segment language, local
eligibility engine, automatic retry after an ambiguous mutation, or MCP layer.
