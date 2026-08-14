# `@fonte-is/cli`

Prepare, verify, test, and remove a Fonte installation in a supported Next.js
App Router project.

```sh
npx @fonte-is/cli init
npx @fonte-is/cli init --yes
npx @fonte-is/cli doctor
npx @fonte-is/cli test --workspace my-workspace
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

When the CLI reports drift, inspect and preserve the local change before
retrying. A `rollback_failed` result means automatic restoration could not be
proved; stop and inspect `package.json`, the lockfile, `.gitignore`, `fonte/`,
and `.fonte/` rather than rerunning the command blindly.

`fonte test` first requires a passing local installation check. It then opens
Fonte in the browser for consent and requests one sandbox email to the verified
email address on the signed-in account. The short-lived OAuth access token stays
in memory for that command and is discarded when the process exits. No token is
copied into the terminal or written to disk.

A successful `doctor` proves only that the local Fonte package metadata,
declared export files, managed file, and ownership manifest agree. The terminal test receipt separates provider
acceptance, refusal, or an unknown provider result from inbox delivery. Only an
accepted email contributes one included sandbox usage unit. Account creation,
arbitrary recipients, production email, and transactional application email
remain unavailable; production capability requires the verified-domain journey.
