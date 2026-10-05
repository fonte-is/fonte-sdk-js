# Application observations

This server-only adapter extends an existing Fonte Website installation. Configure
one application source there, select a successful action and its plan ordering,
then keep the returned source credential in your application's server environment.
It does not replace your authentication, permission, Contact, account or payment
systems. Node.js 20.9 or later is required.

```ts
import { createFonteApplicationSource } from "@fonte-is/core/application";

const observations = createFonteApplicationSource({
  siteId: process.env.FONTE_WEBSITE_SITE!,
  sourceId: process.env.FONTE_APPLICATION_SOURCE!,
  serverKey: process.env.FONTE_APPLICATION_SERVER_KEY!,
  origin: "https://app.example.com",
  policyVersion: "application-observations-v1",
});

// The existing server has authenticated this user, checked permission,
// and committed the requested business operation before this hook runs.
observations.recordAction(
  {
    eventId: committedAction.observationId, // stable UUID owned by the application
    occurredAt: committedAction.committedAt,
    userId: authenticatedUser.id,
    accountId: authenticatedUser.accountId,
    action: "report_saved",
    successful: true,
  },
  {
    activity: measurementPermission.activity,
    identityLink: measurementPermission.identityLink,
  },
);

return businessResult; // Synchronous enqueue never waits for Fonte.
```

Both activity and identity-link permission must explicitly be `granted` for every
record. `denied`, `unknown`, malformed records, unexpected fields, email addresses
and URLs in opaque identity fields are rejected before delivery. No payment data,
tenant identifiers or client-supplied plan ranks are accepted. Credentials define
the server scope; the application supplies facts from its existing authorities.

Use `recordAccess` only after authenticated user access. Use `recordAction` after
the selected business transaction has succeeded. Failed or background actions can
be recorded explicitly; they do not prove successful user use. Optional event IDs
default to fresh UUIDs and timestamps default to the server clock. Supplying the
application's stable event ID permits replay after an uncertain acknowledgement
and later correction.

Use `recordRelationship` for a verified user-to-Contact relationship and its
effective account membership interval. The record carries `validFrom` and optional
`validUntil`, rather than an action timestamp. Source-party references must come
from the existing canonical authority. It performs no email matching or account
inference. Use `recordUpgrade` after the entitlement change is actually committed,
with the previous/effective plan IDs, effective or pending state and explicit
prior-state evidence. Fonte's source configuration owns plan ordering. Use
`retract` with a new event UUID and the original target UUID for corrections or
withdrawal; the SDK never overwrites an earlier event under the same ID.

The client returns a boolean immediately and queues up to 1,000 records in memory.
A full queue rejects the new record. The asynchronous loop sends at most 100
records and 64 KiB per request, with one active request at a time. Requests time
out after at most 750 ms and retry up to three times with stable payloads. A
custom `fetch` implementation must honor its AbortSignal. Redirects are refused,
cookies are omitted, and raw response bodies or transport errors never enter
status or logs.

A valid acknowledgement must name the exact source and every submitted UUID with
a stored, replayed or erased disposition. Lost or invalid acknowledgements keep
the same queue entries for retry. Exhausted retries leave delivery disconnected;
a later enqueue or explicit `flush()` starts a new bounded recovery cycle. A
valid Retry-After up to one day is honored; cooldowns over two seconds end the
current flush immediately rather than holding the application lifecycle open.
Call `flush()` again after the reported cooldown. HTTP 403 or 409 permanently
blocks the client and discards pending entries. Correct the configuration or
conflicting source record before creating a replacement client.

`status()` exposes counts, queue size, delivery state, cooldown and a fixed reason
code. It contains no credentials, record IDs, identities or payloads. `close()` is
idempotent: it aborts delivery and discards remaining memory. Stop the source or
close the corresponding client when source-wide permission is withdrawn; a
captured grant is not permission to collect a later denied operation.
The initial `ready` state means the local adapter can accept records; it does not
prove that a source is connected or available.

This is best-effort delivery. Process exit, redeploy, queue overflow, explicit
close and blocked authorization can lose records before Fonte acknowledges them.
It adds no disk outbox and does not make customer business success depend on
Fonte. Optional `await observations.flush()` belongs only in a separate supported
process-lifecycle drain, followed by `close()`. Server acknowledgement durability,
coverage and payment verification belong to Core, and absence of events does not
prove absence of customer activity.
