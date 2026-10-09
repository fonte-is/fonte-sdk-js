# `@fonte-is/nextjs`

App Router bindings over Core and React. See the Core README for the required
collection policy and `fonte.acquisition.v2` observation and receipt contract.

The application collector must:

1. Read the approved server collection policy; unknown or denied stays disabled.
2. Validate the browser Origin against the configured canonical site origin.
3. Use `collect.parse(request)` for bounded input, then `collect.acceptScope`,
   `collect.minimizeScope`, and `collect.minimizeSourceEvidence` with that policy.
4. Preserve `body.occurredAt`, `body.eventId`, and `body.occurrenceId` on retry.
5. Store the observation through the application's existing collection path,
   using server-owned installation and environment scope.
6. Return an accepted or duplicate receipt only after durable storage, including
   the matching event ID, record ID, and first receipt time. HTTP success alone
   does not confirm acceptance.

The server owns idempotency conflicts, identity linkage, retention, and Fonte
link resolution. These bindings do not include a transport to a Fonte server.
The hosted Website runtime uses its published settings. See the
[Website tracking guide](https://github.com/fonte-is/fonte-sdk-js/blob/main/docs/website-tracking.md)
for field selection and retry limits.
