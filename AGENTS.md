# Fonte SDK JS

- Campaign reads retain both current bound scopes and historical unqualified
  scopes through CLI and MCP validation; unknown or malformed statuses refuse.
  Check `tests/cli-campaign-metadata.test.mjs`.

Keep public APIs compatible and browser code safe to run on customer sites.
Core APIs own tenant and business state; keep credentials out of browser bundles.
Run focused tests and the build for the package being changed.

- Workspace discovery accepts and validates current Core billing access while
  preserving a null operational role for billing-only members. Invalid billing
  values and unrelated fields still refuse. Check:
  `tests/cli-mcp-workspace-catalog.test.mjs` and `tests/cli-mcp-core-http.test.mjs`.
- Contact research uses the ordinary workspace-authenticated Core requester, stable
  mutation identities and observed revisions. Creation and research never imply
  subscription or sending permission. Check `tests/cli-mcp-contact-directory.test.mjs`.
- Organization outreach stops require an explicit organization-wide request,
  current revision and stable operation ID. Only confirmed enforcement means
  queued SMTP is blocked; personal newsletter subscriptions stay unchanged.
  Check `tests/cli-mcp-contact-directory.test.mjs`.

- Timeline tools retain stable milestone IDs, observed revisions, partial event dates and source/word/batch limits through the ordinary checked contact API. Uncertain writes retain their operation ID and never retry automatically. Check `tests/cli-mcp-contact-timeline.test.mjs`.

- A fresh local MCP process exposes the same checked contact operations as the
  hosted server, including organizations, people, relationships, context and
  lists. Discovery makes no authenticated request; each operation uses current
  custody. Check `tests/cli-mcp-local-contacts.test.mjs`.
- On macOS arm64, setup resolves both the private auth host and sandbox client
  inside the executing installed package. It must not depend on a development
  checkout. Check `tests/cli-local-mcp-host.test.mjs`,
  `tests/cli-trusted-mcp-launch-agent.test.mjs` and
  `tests/cli-trusted-mcp-ipc.test.mjs`.

- Contact Description stays optional and separate from Context. Create/update accept
  one plain-text line of at most 20 words/160 characters with 1–3 sources; invalid
  input is refused before authorization or a Core request. Check
  `tests/cli-mcp-contact-directory.test.mjs` and `cli-mcp-local-contacts.test.mjs`.

- Contact activity reads retain Added and explicit recorded-broadcast coverage.
  Confirmed send/click dates are read-only; date predicates use UTC and never
  grant permission. Workspace environment selection still uses Core authority.
  Check `tests/cli-mcp-contact-directory.test.mjs` and the local MCP test.

- Local and hosted MCP expose the same generation-fenced broadcast control
  reads and End command; discovery never authenticates, and uncertain commands
  retain their original identity. Checks: `tests/cli-mcp-broadcast-controls.test.mjs`,
  `tests/cli-mcp-core-http.test.mjs` and `tests/cli-mcp-readiness.test.mjs`.
