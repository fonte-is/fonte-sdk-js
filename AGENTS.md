# Fonte SDK JS

Keep public APIs compatible and browser code safe to run on customer sites.
Core APIs own tenant and business state; keep credentials out of browser bundles.
Run focused tests and the build for the package being changed.

- Workspace discovery accepts and validates current Core billing access while
  preserving a null operational role for billing-only members. Invalid billing
  values and unrelated fields still refuse. Check:
  `tests/cli-mcp-workspace-catalog.test.mjs` and `tests/cli-mcp-core-http.test.mjs`.
