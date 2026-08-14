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
- local preparation, verification, and removal.

V0 does not create an account, activation URL, credential, sender, domain,
contact, payment, provider submission, Test Email, broadcast, or application
email request. Every receipt reports `provider_effect: "none"` and
`application_email: "unavailable"`.

## Invocation

Accepted invocations are exactly:

```text
fonte init [--yes] [--json]
fonte doctor [--json]
fonte remove [--yes] [--json]
fonte --help
fonte --version
```

Flags may appear in either order after a command. Duplicate, unknown, or
command-incompatible flags are usage errors. `--help` and `--version` must be
the only argument. There is no interactive prompt.

Exit codes:

```text
0  planned, applied, verified, removed, help, or version
1  unexpected local execution failure
2  invalid invocation
3  safe product blocker or detected drift; no writes
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

Exactly one App Router layout must exist. Supported layout names are
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
@fonte-is/nextjs@0.1.0` when the dependency was absent;
2. atomically create `fonte/installation.ts` with exclusive semantics;
3. atomically append the ignore block when required;
4. create `.fonte/installation.json` last, with mode `0600` where supported;
5. run the same checks as `doctor`.

The manifest receives a fresh UUID v4 only during apply. The raw UUID is not
authority. Any failure restores exact file snapshots and reconciles npm using
`npm install --ignore-scripts --no-audit --no-fund` after restoring the
original package manifest and lockfile. A failed rollback is reported as
`rollback_failed`; it is never rendered as prepared.

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
- successful resolution of
  `@fonte-is/nextjs/installation-verification` from the customer project;
- successful normalization of manifest metadata through that package;
- one explicit local project check.

The project check runs `npm run typecheck` when that script exists, otherwise
`npm run build` when that script exists. If neither exists, doctor blocks with
`project_check_unavailable`. A nonzero command blocks with
`project_check_failed`. Captured output is not copied into receipts.

## Remove

Remove validates the complete manifest and all managed state before any write.
Any mismatch blocks with `managed_code_drifted` and leaves everything intact.

The ordered removal is the inverse of owned operations:

1. remove the exact direct dependency with
   `npm uninstall --ignore-scripts --no-audit --no-fund @fonte-is/nextjs`;
2. delete the exact-digest managed source file;
3. remove the exact managed ignore block, preserving all other bytes;
4. delete the manifest and remove `.fonte` only when empty.

Removal uses the same snapshot and rollback rules as init.

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

Successful local preparation uses state `prepared`; it does not imply hosted
activation or email readiness. A prepared receipt's next action is exactly:

```json
{
  "kind": "activation_unavailable",
  "reason": "fonte_activation_not_implemented"
}
```

No receipt contains an invented URL. Unknown and unavailable facts are never
rendered as numeric zero.

## Implementation permissions

The implementation task may edit only paths explicitly supplied by the parent.
It may replace `fonte_cli_frame_incomplete` bodies with code conforming to this
contract. It may not add dependencies, files, commands, flags, output fields,
fallback behavior, network calls, telemetry, activation, or email claims.

The fixed private module split is:

```text
arguments.ts       invocation grammar only
project.ts         project and package-manager detection only
plan.ts            pure plan construction and sealing only
plan-material.ts   fixed ordered plan material only
manifest.ts        exact manifest read, parse, and serialization only
filesystem.ts      snapshots and atomic local file operations only
dependency.ts      exact npm dependency posture and commands only
ignore.ts          exact ignore-line/block ownership only
installation-state.ts exact local ownership composition only
project-check.ts   select and run the one sanctioned local check only
doctor.ts          compose read-only verification only
mutations.ts       compose init/remove transactions only
rollback.ts        exact snapshot restoration and npm reconciliation only
program.ts         command dispatch and presentation selection only
```

No implementation body may absorb another module's responsibility merely to
avoid calling the declared helper.
