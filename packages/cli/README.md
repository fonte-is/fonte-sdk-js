# `@fonte-is/cli`

Prepare, verify, test, and remove a Fonte installation in a supported Next.js
App Router project.

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
npx @fonte-is/cli broadcast preflight --workspace my-workspace --environment production --draft-id <uuid> --expected-version 3 --postal-address "1 Synthetic Way"
npx @fonte-is/cli broadcast audience options --workspace my-workspace --environment production
npx @fonte-is/cli broadcast draft create --workspace my-workspace --environment production --idempotency-key <uuid> --title "Product update" --subject "August update" --body "<p>Hello</p>" --sender-profile-id <id> --communication-purpose-id <uuid> --all-contacts
npx @fonte-is/cli broadcast audience preview --workspace my-workspace --environment production --draft-id <uuid>
npx @fonte-is/cli broadcast test send --workspace my-workspace --environment production --draft-id <uuid> --revision 1 --postal-address "1 Synthetic Way" --idempotency-key <key>
npx @fonte-is/cli broadcast authorize --workspace my-workspace --environment production --draft-id <uuid> --revision 1 --postal-address "1 Synthetic Way" --idempotency-key <key>
npx @fonte-is/cli broadcast status --workspace my-workspace --environment production --broadcast-id <uuid> --watch
npx @fonte-is/cli broadcast result --workspace my-workspace --environment production --broadcast-id <uuid>
npx @fonte-is/cli bridge observe resend --workspace my-workspace --environment sandbox --segment-id <provider-id>
npx @fonte-is/cli bridge copy resend --workspace my-workspace --environment sandbox --segment-id <provider-id> --fingerprint <64-lower-hex> --idempotency-key <key>
npx @fonte-is/cli bridge connections list resend --workspace my-workspace --environment production
npx @fonte-is/cli bridge connections connect resend --workspace my-workspace --environment production --display-name "Primary Resend"
npx @fonte-is/cli bridge connections connect kit --workspace my-workspace --environment production --display-name "Primary Kit"
npx @fonte-is/cli bridge collections resend --workspace my-workspace --environment sandbox --connection-id <uuid>
npx @fonte-is/cli bridge reconcile --workspace my-workspace --environment sandbox --source-provider resend --source-connection-id <uuid> --source-collection-id <provider-id> --source-display-name "Subscribers" --max-age-seconds 300
npx @fonte-is/cli bridge import status --workspace my-workspace --environment sandbox --contact-import-batch-id <uuid>
npx @fonte-is/cli bridge reconcile --workspace my-workspace --environment sandbox --source-import-batch-id <uuid> --source-identity-set-sha256 <64-lower-hex> --max-age-seconds 300 --exclude-provider resend --exclude-connection-id <uuid> --exclude-collection-id <provider-id> --exclude-display-name "Protected"
npx @fonte-is/cli bridge freeze --workspace my-workspace --environment sandbox --source-provider resend --source-connection-id <uuid> --source-collection-id <provider-id> --source-display-name "Subscribers" --max-age-seconds 300 --fingerprint <64-lower-hex> --idempotency-key <key>
npx @fonte-is/cli provider-evidence resend --help
npx @fonte-is/cli bridge rotation --help
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

Init may add exact dependency `@fonte-is/nextjs@0.1.0`, create
`fonte/installation.ts`, append a managed `.gitignore` block, and create the
ignored `.fonte/installation.json` ownership manifest. Doctor reads only
Fonte-owned installation state and never runs project scripts. Remove refuses
to overwrite drifted or concurrently changed files and reports a distinct
rollback failure when exact restoration cannot be proven.

When the CLI reports drift, inspect and preserve the local change before
retrying. A `rollback_failed` result means automatic restoration could not be
proved; stop and inspect `package.json`, the lockfile, `.gitignore`, `fonte/`,
and `.fonte/` rather than rerunning the command blindly.

## Persistent sign-in

Run `fonte auth login` once. Later `auth exec`, broadcast, Bridge and hosted test
commands reuse that sign-in and refresh silently. `fonte auth status` reports
local custody without discovery or server validation; `fonte auth logout` removes this machine's
stored CLI credential, including when the identity service is unreachable.
All three commands support `--json`. Use `fonte auth login --switch-account`
to replace the current CLI sign-in explicitly. Set `FONTE_NONINTERACTIVE=1` to
disable browser and native human interaction; other values are invalid.

The refresh credential is stored through Fonte's private native adapter using
macOS Keychain, Windows Credential Manager, or Linux Secret Service on the
packaged targets. These facilities must be available and unlocked. Linux never
falls back to kernel keyutils or Windows custody under WSL. There is no plaintext
file, environment-variable, shell-command, or alternate native-store fallback.
Local installation commands remain available without credential storage.

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
the child's environment. No token is placed in arguments, terminal output,
receipts, or plaintext files. The child should read the value once, delete it
from `process.env`, keep it in memory, and avoid rendering it:

```js
const bearer = process.env.FONTE_HUMAN_BEARER;
delete process.env.FONTE_HUMAN_BEARER;
if (!bearer) throw new Error("Fonte human authorization is required");
await bootstrapLocalCore({ bearer });
```

The spawned consumer owns its subsequent API use. This command itself makes
no Core API, provider, email, or production request.

## Sequence authoring and activation MCP

`fonte-mcp` is a stdio MCP server for the same Core-owned Sequence authoring
and activation surface as the `fonte sequence` commands. It has exactly nine
tools: list, read, create, update, validate, diff, export, simulate, and
activate. It keeps the browser OAuth bearer only in memory and uses no local
Sequence state.

Activation freezes one exact Core draft revision and its sender/scope/render
references. It cannot enroll a subscriber, select a recipient, send email,
report a provider outcome, or control runtime work. Create, update, and
activate require a caller-owned Sequence ID and operation key. If any mutation
is ambiguous, the server returns `outcome: "ambiguous"` with
`core_effect: "unknown"`; it never resubmits the mutation. A draft mutation
can be read through `fonte_read_sequence`; activation intentionally receives no
invented readback because a draft read cannot prove an activated version.

See [MCP_CONTRACT.md](./MCP_CONTRACT.md) for the fixed tool allowlist and
authentication boundary.

## Workspace invitation client

`@fonte-is/cli/operator-client` exports `createCoreOperatorClient` for the
existing owner-create and invited-subject claim journey:

```js
import { createCoreOperatorClient } from "@fonte-is/cli/operator-client";

const client = createCoreOperatorClient({ coreApiBaseUrl, bearer, fetch });
const created = await client.createWorkspaceInvitation({
  workspace: "my-workspace",
  environment: "production",
  intendedSupabaseSubject: "verified-subject",
  intendedEmail: "invitee@example.test",
  role: "operator",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const claimed = await client.claimWorkspaceInvitation({
  workspace: "my-workspace",
  environment: "production",
  invitationToken: created.invitation_token,
});
const contexts = await client.listWorkspaceContexts();
```

The owner transfers `invitation_token` to the intended verified subject through
an approved out-of-band channel. The client sends it only in the claim request
body and does not persist it. Bearers and invitation tokens must never enter
URLs, query strings, command arguments, logs, telemetry, or receipts.

If a claim response is lost, re-authenticate and replay the exact same claim
with the same token, workspace, and environment. Core returns the same grant;
`replayed: true` with `grant_created: false` identifies that replay.
`listWorkspaceContexts()` is the read-only workspace-context readback after a
refresh or relogin. Do not create a replacement invitation when create has an
unknown Core effect: this client exposes no invitation-create readback route.

The fixed synthetic sandbox draft is retained in the workspace as an audit
artifact. Its ID and retention are always reported, including when a later step
fails. A refused or unknown provider result exits `3`; only provider acceptance
exits `0`.

A successful `doctor` proves only that the local Fonte package metadata,
declared export files, managed file, and ownership manifest agree. The terminal test receipt separates provider
acceptance, refusal, or an unknown provider result from inbox delivery. Only an
accepted email contributes one included sandbox usage unit. Account creation,
arbitrary recipients, production email, and transactional application email
remain unavailable; production capability requires the verified-domain journey.

The operator commands are thin stored-session Core clients and do not
require a Next.js project. V1 implements the fixed sandbox canary, the bounded
production draft/audience/test/preflight/authorization/control/result journey,
Resend preview plus explicit fingerprint-bound copy, and Core-owned provider
collection discovery, reconciliation, and explicit fingerprint-bound audience
freeze. Contact-import status returns Core's exact completed batch UUID and
identity-set SHA-256 for frozen-source reconciliation. Connection commands use
Resend or Kit's native OAuth consent; provider tokens stay in Core's encrypted
custody and never enter terminal input, command arguments, environment, files,
logs, or CLI receipts. Resend requires
`full_access` for these read-only Bridge operations. Kit OAuth remains
unavailable until its exact application and scope configuration is admitted.
Reconciliation output contains only provenance and aggregate counts;
contact rows are never rendered. The CLI selects
audiences only by Core IDs, never filenames, and never computes eligibility.
Preflight observes one exact persisted draft revision. Authorization reuses
Core's existing authority and immutable recipient freeze. Lost mutation
responses remain unknown until explicit readback. Unexposed declarations return
`unsupported_authority` before OAuth or network access.

The candidate evidence journey is JSON-only and the rotation journey is
aggregate-only. Rotation follows one closed sequence: `start`, `read`, then
`advance` once with the exact page number reported by the latest read and
`read` again as directed; when Core reports readiness, run `seal`, then one
final `read`. Never repeat `start`, `advance`, or `seal` after an ambiguous
response. The receipt keeps `core_effect: unknown`, sets
`retry_mutation: false`, and supplies the exact readback command when all
guards are known.

Core classifies the fresh live population into four disjoint private sealed
sets whose union must equal the population root. `E` is eligible now after
current safety, positive qualifying-broadcast, created-at, portability, and
Fonte-custody checks. `W` has no qualifying-broadcast recipient history and
must remain for warming. `X` is excluded by current unsubscribe, bounce,
complaint, suppression, or protected Fonte custody. `U` has unknown or missing
custody, broadcast, created-at, or portability evidence; any `U` blocks the
outgoing selector. The CLI renders only category counts, sealed identities,
checksums, and progress—not contact or provider rows.

See [OPERATOR_CONTRACT.md](./OPERATOR_CONTRACT.md) for the exact command,
authority, receipt, and future MCP boundary.

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
