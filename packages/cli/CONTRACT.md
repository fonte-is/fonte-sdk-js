# Fonte CLI V0 implementation contract

This file is the implementation authority for the first `@fonte-is/cli`
candidate. Implementers may fill the declared function bodies. They may not
change package identity, public behavior, paths, schemas, vocabulary, or
verification semantics without returning the fork to the parent task.

## Boundary

The package is `@fonte-is/cli`; its only binary is `fonte`. The source remains
under `packages/cli` so a later registry-name change to `fonte` does not change
the implementation architecture.

V0 supports only:

- Node.js 20.9 or newer;
- npm projects;
- Next.js App Router projects with exactly one of `app/layout.*` or
  `src/app/layout.*`;
- exact SDK version `0.1.0` from `@fonte-is/nextjs`;
- local preparation, verification, and removal;
- one browser-authorized sandbox provider proof to the signed-in account's
  verified email address.

V0 does not create an account, arbitrary recipient, sender, domain, contact,
payment, production broadcast, or transactional application-email request.
Local-command receipts retain `provider_effect: "none"` and
`application_email: "unavailable"`. The separate test receipt reports only the
hosted sandbox provider result it actually reads back.

## Invocation

Accepted invocations are exactly:

```text
fonte init [--yes] [--json]
fonte doctor [--json]
fonte test --workspace <slug> [--json]
fonte remove [--yes] [--json]
fonte --help
fonte --version
```

Flags may appear in either order after a command. Duplicate, unknown, or
command-incompatible flags are usage errors. `--help` and `--version` must be
the only argument. There is no terminal prompt. `test` opens the system browser
for an existing signed-in human to approve the registered public CLI client.
The workspace slug is explicit, lowercase, and remains subject to server-side
Fonte workspace membership.

## Hosted sandbox proof

The CLI fetches `https://fonte.is/.well-known/fonte-cli.json`, accepts only
schema `fonte.cli.hosted_config.v1`, HTTPS authority/API URLs, scope `email`,
and callback `http://127.0.0.1:49671/callback`. OAuth Authorization Code with
mandatory S256 PKCE is implemented by `openid-client`; Fonte does not implement
production cryptography.

The callback listener binds only `127.0.0.1:49671`, requires the exact Host,
path, random state, and one code-or-error result. The OAuth access token remains
in process memory. It is never rendered, copied by the user, placed in an
installation manifest, or refreshed on disk.

After a passing Doctor check, `test` creates fixed synthetic sandbox content,
requests the existing signed-in sandbox canary, and polls its existing readback.
The server chooses the verified account email and platform sandbox sender. The
CLI cannot provide an arbitrary recipient or sender. The terminal receipt uses
schema `fonte.cli.test_receipt.v1`, preserves accepted/refused/unknown, records
one included unit only for accepted, and always reports
`inbox_delivery_confirmed: false`, `token_persisted: false`, and
`production_email: "locked_pending_verified_domain"`.
The fixed sandbox draft remains as a workspace audit artifact. Every test
receipt reports `sandbox_draft_id` and `sandbox_draft_retained`; failures before
creation report `null` and `false`. If the create request may have committed but
its response is lost, both fields report `null`; the retention value therefore
means unknown rather than falsely claiming that no draft exists.

Exit codes:

```text
0  planned, applied, verified, removed, help, version, or accepted sandbox proof
1  unexpected local execution failure
2  invalid invocation
3  safe product blocker, detected drift, refused proof, or unknown proof
```

`init` and `remove` without `--yes` return a plan with exit 0 and make no
changes. `--json` writes exactly one JSON object plus a trailing newline to
stdout. Human mode writes only the literal rendering selected by the receipt.
Diagnostics do not expose absolute paths, environment values, or command
output containing secrets.

Help, version, usage-error, and unexpected-error bytes are the exact exported
constants in `constants.ts`. Usage errors always write `USAGE_TEXT` to stderr,
write nothing to stdout, and exit 2, even when `--json` appeared in the invalid
input. Unexpected failures write `EXECUTION_ERROR_TEXT` to stderr, write
nothing to stdout, and exit 1.

## Fixed paths and content

The project-relative managed source path is `fonte/installation.ts`. Its exact
bytes are exported by `MANAGED_SOURCE_TEXT`; no adapter may alter them.

The non-secret local manifest is `.fonte/installation.json`. It must be
ignored. If neither `/.fonte/` nor `.fonte/` already appears as a complete
`.gitignore` line, init appends the exact `IGNORE_BLOCK_TEXT`. Removal deletes
only that exact block when the originating manifest says Fonte added it.

Absolute paths, parent traversal, `.git`, `node_modules`, and any symlink in a
managed path are rejected before writes.

## Detection

Detection reads the root `package.json`. Missing or invalid JSON blocks with
`project_manifest_invalid`.

The package manager is npm when no foreign lockfile exists and either:

- `packageManager` is absent or begins with `npm@`; or
- `package-lock.json` exists.

`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, or a non-npm
`packageManager` blocks with `unsupported_package_manager`.

Exactly one regular, non-symlink App Router layout file must exist. Supported layout names are
`layout.js`, `layout.jsx`, `layout.ts`, and `layout.tsx`. None blocks with
`unsupported_framework`; layouts under both `app` and `src/app` block with
`ambiguous_app_router_root`.

## Init plan

The ordered operation identities are:

```text
sdk_dependency       dependency  package.json
installation_module  create_file fonte/installation.ts
local_state_ignore   managed_block .gitignore   (only when needed)
local_manifest       create_local_manifest .fonte/installation.json
```

`@fonte-is/nextjs` may be absent or exactly `0.1.0` in `dependencies`. Presence
in another dependency section or any other value blocks with
`dependency_version_conflict`. A pre-existing `fonte/installation.ts` without
a valid Fonte manifest blocks with `existing_unmanaged_path`, even when its
bytes happen to match.

The plan SHA-256 is computed over canonical compact UTF-8 JSON for the complete
plan without `plan_sha256`. Object keys are recursively sorted; array order is
preserved; non-ASCII characters remain unescaped. Undefined values and
non-finite numbers are invalid.

## Apply and rollback

Before writes, apply re-detects the project, recomputes the plan, and requires
the same digest. It preflights every target and snapshots `package.json`, an
existing `package-lock.json`, `.gitignore`, and every target file.

Apply executes in this order:

1. `npm install --save-exact --ignore-scripts --no-audit --no-fund
@fonte-is/nextjs@0.1.0` when the dependency was absent, adding
   `--package-lock=false` when the project began without `package-lock.json`;
2. atomically create `fonte/installation.ts` with exclusive semantics;
3. atomically append the ignore block when required;
4. create `.fonte/installation.json` last, with mode `0600` where supported;
5. run the same checks as `doctor`.

The manifest receives a fresh UUID v4 only during apply. The raw UUID is not
authority. Before each managed mutation and during rollback, the CLI compares
bytes, mode, device, and inode with its exact preimage or produced state. A
change observed at those checkpoints blocks and is preserved. This protects
ordinary concurrent edits; it does not claim atomic protection against an
actively racing local process. When npm reconciliation is required, rollback restores the
original manifests, reconciles with scripts disabled, then restores the exact
original manifest and lockfile bytes again. Projects that began without a
lockfile use `--package-lock=false` throughout. A failed rollback is reported
as `rollback_failed`; it is never collapsed into an ordinary execution error
or rendered as prepared.

## Manifest

The manifest has exactly these top-level keys:

```text
schema_version
installation_id
cli_version
adapter_id
adapter_version
sdk_package
sdk_version
plan_sha256
managed_operations
```

Its fixed values are:

```text
schema_version  fonte.local_installation.v1
cli_version     0.1.0
adapter_id      next_app_router
adapter_version v1
sdk_package     @fonte-is/nextjs
sdk_version     0.1.0
```

`managed_operations` excludes `local_manifest` and contains only operations
actually owned by Fonte. A dependency already present at the exact version and
a pre-existing exact ignore line are not owned and must not be removed.

## Doctor

Doctor is read-only. It verifies:

- exact manifest schema and keys;
- UUID v4 installation ID;
- exact package version in `dependencies` and installed package metadata;
- exact digest of every Fonte-created file;
- exact ignore ownership state;
- safe normalized paths without symlink escape;
- the exact declared `@fonte-is/nextjs/installation-verification` export paths;
- regular, non-symlink JavaScript and declaration files at those paths.

Doctor never executes project scripts or installed package code. Either could
write files, contact the network, or invoke providers, so neither can be part
of a read-only verification receipt.

## Remove

Remove validates the complete manifest and all managed state before any write.
Any mismatch blocks with `managed_code_drifted` and leaves everything intact.

The ordered removal is the inverse of owned operations:

1. remove the exact direct dependency with
   `npm uninstall --ignore-scripts --no-audit --no-fund @fonte-is/nextjs`,
   adding `--package-lock=false` when the project has no lockfile;
2. delete the exact-digest managed source file;
3. remove the exact managed ignore block, preserving all other bytes;
4. delete the manifest and remove `.fonte` only when empty.

Removal uses the same snapshot and rollback rules as init.
Successful npm removal is semantically reversible, but npm may retain its own
JSON formatting or key-order changes. Rollback remains byte-exact.

## Receipt contract

Receipts have exactly these top-level keys in this order:

```text
schema_version
command
outcome
state
reason
local_verification
account_created
provider_effect
application_email
operations
next_action
```

Fixed values are:

```text
schema_version     fonte.cli.receipt.v1
account_created    false
provider_effect    none
application_email  unavailable
```

Successful local preparation uses state `prepared`; it does not imply
production email readiness. A prepared receipt's next action is exactly:

```json
{
  "kind": "run_command",
  "command": "npx @fonte-is/cli test --workspace <slug>"
}
```

No receipt contains an invented URL. Unknown and unavailable facts are never
rendered as numeric zero.

## Implementation permissions

The implementation task may edit only paths explicitly supplied by the parent.
It may replace `fonte_cli_frame_incomplete` bodies with code conforming to this
contract. Hosted-test implementation may add only the declared OAuth library,
fixed browser bridge, exact hosted calls, and test receipt. It may not add
fallback authority, token persistence, telemetry, arbitrary recipients, or
production/application-email claims.

The fixed private module split is:

```text
arguments.ts       invocation grammar only
project.ts         project and package-manager detection only
plan.ts            pure plan construction and sealing only
plan-material.ts   fixed ordered plan material only
installation-plan.ts read-only project state inspection and plan composition only
manifest.ts        exact manifest read, parse, and serialization only
filesystem.ts      snapshots and atomic local file operations only
dependency.ts      exact npm dependency posture and commands only
ignore.ts          exact ignore-line/block ownership only
installation-state.ts exact local ownership composition only
mutation-journal.ts record exact CLI-produced filesystem states only
doctor.ts          compose read-only verification only
mutations.ts       compose init/remove transactions only
rollback.ts        exact snapshot restoration and npm reconciliation only
program.ts         command dispatch and presentation selection only
```

No implementation body may absorb another module's responsibility merely to
avoid calling the declared helper.
