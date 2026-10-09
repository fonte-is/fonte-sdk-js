# `@fonte-is/cli`

Send Broadcasts and manage Fonte from your terminal, or install Fonte in a
supported Next.js App Router project.

```sh
npx @fonte-is/cli init
npx @fonte-is/cli init --yes
npx @fonte-is/cli doctor
npx @fonte-is/cli test --workspace my-workspace
npx @fonte-is/cli auth exec -- npm run local:core-bootstrap
npx @fonte-is/cli sequence create --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --operation-key create-welcome --definition '{"schema":"sequence_definition.v1","title":"Welcome","entry":{"kind":"subscription_episode"},"reentry":"once","steps":[{"id":"welcome","kind":"send","subject":null,"message":null}]}'
npx @fonte-is/cli sequence read --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --json
npx @fonte-is/cli sequence update --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --expected-revision 1 --operation-key update-welcome --definition '<definition-json>'
npx @fonte-is/cli sequence activate --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --expected-revision 2 --operation-key activate-welcome --binding '{"senderId":"sender-sequence-welcome","scope":{"kind":"general_marketing"},"messageRenderReferences":[{"stepId":"welcome","renderReference":"render-welcome"}]}' --json
npx @fonte-is/cli sequence validate --workspace my-workspace --environment sandbox --definition '<definition-json>'
npx @fonte-is/cli sequence diff --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --base-revision 1 --definition '<definition-json>'
npx @fonte-is/cli sequence export --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --json
npx @fonte-is/cli sequence simulate --workspace my-workspace --environment sandbox --sequence-id welcome-sequence --entered-at-ms 0 --assumed-accepted-at-ms '{"welcome":0}' --json
npx @fonte-is/cli broadcast test send --workspace my-workspace --environment sandbox --draft-id <uuid> --revision 1 --idempotency-key <key>
npx @fonte-is/cli broadcast test status --workspace my-workspace --environment sandbox --test-id <uuid> --watch
npx @fonte-is/cli broadcast audience options --workspace my-workspace --environment production
npx @fonte-is/cli broadcast draft create --workspace my-workspace --environment production --idempotency-key <uuid> --title "Product update" --subject "August update" --body "<p>Hello</p>" --sender-profile-id <id> --communication-purpose-id <uuid> --all-contacts
npx @fonte-is/cli broadcast audience preview --workspace my-workspace --environment production --draft-id <uuid>
npx @fonte-is/cli broadcast test send --workspace my-workspace --environment production --draft-id <uuid> --revision 1 --postal-address "1 Synthetic Way" --idempotency-key <key> --text-body "Hello" --html-body "<p>Hello</p>"
npx @fonte-is/cli broadcast review --workspace my-workspace --environment production --draft-id <uuid> --expected-version 1 --request-id <uuid> --json
npx @fonte-is/cli broadcast send --send-input '<exact reviewed send_input JSON>' --json
npx @fonte-is/cli broadcast operation --workspace my-workspace --environment production --draft-id <uuid> --operation-uri <returned-uri> --kind send --json
npx @fonte-is/cli broadcast status --workspace my-workspace --environment production --broadcast-id <uuid> --watch
npx @fonte-is/cli broadcast result --workspace my-workspace --environment production --broadcast-id <uuid>
npx @fonte-is/cli connections choices --workspace my-workspace --environment sandbox
npx @fonte-is/cli connections list --workspace my-workspace --environment sandbox
npx @fonte-is/cli connections authorize --workspace my-workspace --environment sandbox --choice-ref <ref> --attempt-id <uuid> --display-name "Primary account"
npx @fonte-is/cli contacts sources --workspace my-workspace --environment sandbox --connection-ref <ref>
npx @fonte-is/cli contacts preview --workspace my-workspace --environment sandbox --source-ref <ref>
npx @fonte-is/cli contacts import --workspace my-workspace --environment sandbox --source-ref <ref> --idempotency-key <key>
npx @fonte-is/cli contacts import-status --workspace my-workspace --environment sandbox --operation-ref <ref>
npx @fonte-is/cli audience reconcile --workspace my-workspace --environment sandbox --source-ref <ref>
npx @fonte-is/cli audience freeze --workspace my-workspace --environment sandbox --source-ref <ref> --fingerprint <sha256> --idempotency-key <key>
npx @fonte-is/cli bridge import status --workspace my-workspace --environment sandbox --contact-import-batch-id <uuid>
npx @fonte-is/cli remove
npx @fonte-is/cli remove --yes
```

`init` without `--yes` prints a deterministic plan and makes no changes. The
CLI supports Node.js 20.9 or newer and npm projects with exactly one regular
Next.js App Router `app/layout.*` or `src/app/layout.*` file. Add `--json` to
receive a machine-readable receipt. Exit codes are `0` for success or a plan,
`1` for execution or rollback failure, `2` for invalid invocation, and `3` for
a safe blocker, detected drift, or a sandbox provider result that was not
accepted.

Init may add exact dependency `@fonte-is/nextjs@0.2.0`, create
`fonte/installation.ts`, append a managed `.gitignore` block, and create the
ignored `.fonte/installation.json` ownership manifest. Doctor reads only
Fonte-owned installation state and never runs project scripts. Remove refuses
to overwrite drifted or concurrently changed files and reports a distinct
rollback failure when exact restoration cannot be proven.

For a recorded 0.1 installation, `doctor` checks that its original files and
metadata remain intact; it does not prove compatibility with the new actions.
`init` blocks rather than upgrading that installation. An intact older
installation can still be removed through its recorded ownership manifest.

When the CLI reports drift, inspect and preserve the local change before
retrying. A `rollback_failed` result means automatic restoration could not be
proved; stop and inspect `package.json`, the lockfile, `.gitignore`, `fonte/`,
and `.fonte/` rather than rerunning the command blindly.

## Connected contacts

Choose an account type from `connections choices`, authorize it, then use the
connection and source references returned by Fonte. Preview a source before
importing it. Fonte imports into Contacts and preserves current protection and
permission evidence. Importing does not establish consent or send email.

If an import response is uncertain, reuse its original idempotency key. Fonte
resumes the retained input; it does not replace it with a later source snapshot.
Use `import-status` to read an operation. Audience reconciliation is a separate
observation; freezing requires its exact fingerprint and an idempotency key.
Run `fonte connections --help`, `fonte contacts --help` or
`fonte audience --help` for the full command syntax.

## Persistent sign-in

Run `fonte auth login` once. Later authenticated commands reuse that sign-in and
refresh silently. `fonte auth status` reports
local custody without discovery or server validation; `fonte auth logout` removes this machine's
stored CLI credential, including when the identity service is unreachable.
All three commands support `--json`. Use `fonte auth login --switch-account`
to replace the current CLI sign-in explicitly. Set `FONTE_NONINTERACTIVE=1` to
disable browser and native human interaction; other values are invalid.

The CLI prefers the OS credential store when its native helper is available.
If native storage is unavailable before sign-in starts, interactive
`fonte auth login` can offer a per-user session file. This requires your explicit
choice. The file stores the refresh credential under restrictive filesystem
permissions; it is not encrypted by the CLI. Those permissions protect it from
other OS users, not other processes running as you. Later commands reuse the
selected store and never switch stores silently. `fonte auth status --json`
reports the selected store and its availability. Access tokens are never saved
to disk. Local installation commands need no credential storage.

Each new process obtains a fresh access token and verifies the authenticated
user through the configured issuer. Login is bound to the exact issuer, client,
scopes, API target, redirect and user. Refresh, logout and account changes are
serialized across processes. Interrupted or uncertain refresh requires a new
login; no old refresh token is silently retried. Core still checks workspace,
environment and action permission for every command. Logout removes local
custody but remote revocation is unsupported in this release; it cannot revoke
an already handed-off child's bearer or another installation.

`fonte test` requires a passing installation check and requests one sandbox email
to the signed-in account's verified email. Its v2 receipt reports
`token_persisted: true` only for confirmed secure refresh custody, `false` for
known absence, and `null` when a failed store operation leaves custody unknown.
Access tokens remain in memory and are discarded on process exit.

`fonte auth exec -- <command> [args...]` directly spawns the command without a
shell and supplies its ephemeral access token only as `FONTE_HUMAN_BEARER` in
the child's environment. The access token is never placed in arguments,
terminal output, receipts or plaintext files. The child should read it once, delete it
from `process.env`, keep it in memory, and avoid rendering it:

```js
const bearer = process.env.FONTE_HUMAN_BEARER;
delete process.env.FONTE_HUMAN_BEARER;
if (!bearer) throw new Error("Fonte human authorization is required");
await bootstrapLocalCore({ bearer });
```

The spawned consumer owns its subsequent API use. This command itself makes
no Core API, provider, email, or production request.

## Sequence and Broadcast MCP

`fonte-mcp` is a stdio MCP server for the same Core-owned Sequence authoring
surface and Broadcast draft, targeting, render, test, review and Send operations
as the corresponding `fonte` commands. Access tokens stay in memory. Local
Broadcast requests are saved before submission so their exact input and request
ID can be recovered after a restart or lost response.

Activation freezes one exact Core draft revision and its sender/scope/render
references. It cannot enroll a subscriber, select a recipient, send email,
report a provider outcome, or control runtime work. Create, update, and
activate require a caller-owned Sequence ID and operation key. If any mutation
is ambiguous, the server returns `outcome: "ambiguous"` with
`core_effect: "unknown"`; it never resubmits the mutation. A draft mutation
can be read through `fonte_read_sequence`; activation intentionally receives no
invented readback because a draft read cannot prove an activated version.

For Broadcast, `fonte_prepare_broadcast` reviews an exact saved draft version.
It does not send. After the customer approves the ready review, submit the
complete saved input through `fonte_send_broadcast`.
`fonte_read_broadcast_send_operation` reads the returned operation URI without
advancing work. The local `fonte_recover_broadcast_request` tool replays the
original saved request. Through the public HTTP endpoint, the caller retains
and replays that complete input instead; no local recovery file is available.

The local `fonte_send_broadcast_now` and `fonte_schedule_broadcast` tools refuse
new sends. Existing instruction status, schedule replacement, cancellation
and spend-limit tools remain available locally and check Core's current
instruction and approval generations.

See [MCP_CONTRACT.md](./MCP_CONTRACT.md) for the fixed tool allowlist and
authentication boundary.

## Workspace invitation client

`@fonte-is/cli/operator-client` exports `createCoreOperatorClient` for the
workspace invitation journey. The owner creates an invitation for an email
address; the invited person claims it while signed in with that verified email:

```js
import { createCoreOperatorClient } from "@fonte-is/cli/operator-client";

const owner = createCoreOperatorClient({
  coreApiBaseUrl,
  bearer: ownerBearer,
  fetch,
});
const created = await owner.createWorkspaceInvitation({
  workspace: "my-workspace",
  environment: "production",
  intendedEmail: "invitee@example.test",
  role: "operator",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const invitee = createCoreOperatorClient({
  coreApiBaseUrl,
  bearer: inviteeBearer,
  fetch,
});
const claimed = await invitee.claimWorkspaceInvitation({
  workspace: "my-workspace",
  environment: "production",
  invitationToken: created.invitation_token,
});
const contexts = await invitee.listWorkspaceContexts();
```

The owner transfers `invitation_token` privately to the intended person. The
client sends it only in the claim request
body and does not persist it. Bearers and invitation tokens must never enter
URLs, query strings, command arguments, logs, telemetry, or receipts.

If a claim response is lost, re-authenticate and replay the exact same claim
with the same token, workspace, and environment. Core returns the same grant;
`replayed: true` with `grant_created: false` identifies that replay.
`listWorkspaceContexts()` is the read-only workspace-context readback after a
refresh or relogin. Do not create a replacement invitation when create has an
unknown Core effect: this client exposes no invitation-create readback route.

## Sandbox verification

The fixed synthetic sandbox draft is retained in the workspace as an audit
artifact. Its ID and retention are always reported, including when a later step
fails. A refused or unknown provider result exits `3`; only provider acceptance
exits `0`.

A successful `doctor` proves only that the local Fonte package metadata,
declared export files, managed file, and ownership manifest agree. The terminal test receipt separates provider
acceptance, refusal, or an unknown provider result from inbox delivery. Only an
accepted email contributes one included sandbox usage unit. This sandbox test
does not create an account or send production or transactional email, and it
cannot select an arbitrary recipient. Production sending requires domain setup
and the Broadcast workflow below.

Authenticated product commands do not require a Next.js project. Connection
commands list Fonte's available choices, authorize an account and return scoped
references. Contact commands discover, preview, import and read source
operations. Audience reconciliation observes the exact source and exclusions;
freeze separately requires that observation's fingerprint and an idempotency
key. Contact-import status returns the completed batch and its canonical
identity hash. External account tokens stay in Core's custody, and
reconciliation output omits contact rows. Core owns eligibility and sending.
Lost mutation responses remain uncertain until the operation's supported
readback or replay resolves them.

## Broadcast Send

Run `broadcast review` for the exact saved draft version. A ready review
contains the recipient summary and references for approval; it does not return
a finished `send_input` or send email. After the customer approves that review,
use the exported helper to create the saved input:

```js
import { approvedBroadcastSendInput } from "@fonte-is/cli/broadcast-client";

const sendInput = approvedBroadcastSendInput(
  { workspace: "my-workspace", environment: "production", draftId },
  coreApiBaseUrl,
  reviewReceipt,
  sendRequestId,
);
```

Here `reviewReceipt` is the ready `operation` from the review command, and
`sendRequestId` is a new UUID. Submit `JSON.stringify(sendInput)` through
`broadcast send --send-input`. The helper binds the exact review and scope; it
does not ask for approval on the customer's behalf. The alternative
`boundedDirectBroadcastSendInput` helper accepts an explicitly approved maximum
charge in place of review references. Both inputs request immediate sending;
future scheduling is unavailable for a new Send in this release.

The local CLI saves the input before submission. After response loss, run
`broadcast send recover` with the original request ID, workspace, environment
and draft. Recovery replays the unchanged request; Core enforces idempotency.
Do not use a new request ID or changed material to recover an uncertain Send.
`broadcast operation` reads the returned operation URI. A bounded wait can
return pending while Core continues working. Business acceptance, execution
readiness, provider acceptance and delivery remain separate outcomes.

The old `broadcast authorize`, `broadcast send now` and `broadcast send
schedule` commands refuse new sends with `canonical_send_review_required`.

See [OPERATOR_CONTRACT.md](./OPERATOR_CONTRACT.md) for the exact command,
permission, recovery and receipt details.

## Sequence authoring and activation

`sequence list`, `read`, `create`, `update`, `validate`, `diff`, `export`, and
`simulate` are thin stored-session Core clients over the same persisted
Sequence definition used by future Web views and runtime work. `sequence
activate` freezes one exact persisted revision and its Core binding. None of
the commands create local Sequence state. Definitions and activation bindings
are supplied as JSON objects; Core is the validator and durable store.

Create, update, and activation require a caller-owned `--sequence-id` and an
`--operation-key`. If a draft mutation response is lost, do not retry it: the
CLI reports `core_effect: "unknown"` and supplies the exact `sequence read`
command for authoritative recovery. An ambiguous activation is also unknown,
without retry or an invented draft readback. Validation, diff, export, and
simulation are authoring-only operations. Activation records a version/binding
only; it does not enroll a contact or request delivery.
