# Application reference for Next.js

This reference uses the server-only `@fonte-is/nextjs/application` export from
the local SDK candidate. Bind `server/existing-ports.ts` to your application's
existing authentication, report store, and entitlement store before running it.
The unbound ports fail closed.

See [the integration contract](../../docs/application-reference.md) for source
configuration, identity and permission rules, transaction hooks, and lifecycle
delivery. The executable qualification uses synthetic ports and a local HTTP
receiver; it is not a customer pilot or payment-provider qualification.
