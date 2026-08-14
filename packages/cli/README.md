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
CLI supports npm projects only in this release. It never creates a Fonte
account, stores a production credential, contacts an email provider, or sends
email.

A successful `doctor` proves only that the local Fonte package, managed file,
manifest, and project check agree. Activation and application email remain
unavailable until their hosted authority and API contracts are implemented.
