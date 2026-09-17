# `@fonte-is/nextjs`

App Router bindings over Core and React. See the Core README for the required
collection policy and `fonte.acquisition.v1` observation/receipt contract.

The application collector must:

1. Read the approved server collection policy; unknown/denied stays disabled.
2. Validate the browser Origin against a configured canonical site origin.
3. Use `collect.parse(request)` for bounded streaming input, then
   `collect.acceptScope` and `collect.minimizeScope` before forwarding.
4. Preserve `body.occurredAt`, `body.eventId`, and `body.occurrenceId` on retry.
5. Forward through the sanctioned `/v1/touches` client with server-owned
   installation/environment scope. Never accept a browser-supplied tenant.
6. Return an explicit accepted/duplicate receipt only after durable custody is
   confirmed, including the logical event ID, record ID, and first receipt time.
   A legacy HTTP success or ignored result must not be upgraded to acceptance.

The runtime owns idempotency conflicts, identity linkage, retention, and
source-token resolution. Unsupported runtime capabilities stay unavailable;
this adapter supplies no replacement authority. Analytics must remain outside
signup and sending's required dependency path.
