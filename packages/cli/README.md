# `@fonte-is/cli`

Prepare, verify, and remove a local Fonte installation in a supported Next.js
App Router project.

```sh
npx @fonte-is/cli init
npx @fonte-is/cli init --yes
npx @fonte-is/cli doctor
npx @fonte-is/cli remove
npx @fonte-is/cli remove --yes
```

`init` without `--yes` prints a deterministic plan and makes no changes. The
CLI supports Node.js 20.9 or newer and npm projects with exactly one regular
Next.js App Router `app/layout.*` or `src/app/layout.*` file. Add `--json` to
receive a machine-readable receipt. Exit codes are `0` for success or a plan,
`1` for execution or rollback failure, `2` for invalid invocation, and `3` for
a safe blocker or detected drift.

Init may add exact dependency `@fonte-is/nextjs@0.1.0`, create
`fonte/installation.ts`, append a managed `.gitignore` block, and create the
ignored `.fonte/installation.json` ownership manifest. Doctor reads only
Fonte-owned installation state and never runs project scripts. Remove refuses
to overwrite drifted or concurrently changed files and reports a distinct
rollback failure when exact restoration cannot be proven.

The CLI never creates a Fonte account, stores a production credential,
contacts an email provider, or sends email.

A successful `doctor` proves only that the local Fonte package, managed file,
manifest, and project check agree. Activation and application email remain
unavailable until their hosted authority and API contracts are implemented.
