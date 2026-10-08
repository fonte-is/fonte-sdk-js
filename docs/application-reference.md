# Next.js application reference

The reference in `examples/application-nextjs` adds authenticated application
observations to an **existing Website installation** through the server-only
`@fonte-is/nextjs/application` export. It keeps the application's existing
authentication, account authorization, Contact mapping, business transactions,
and entitlement store. Keep the existing Website collector in the host layout.

This is source and local protocol qualification using explicitly synthetic host
ports. It is not a customer pilot, a verified payment-provider connection, or a
complete qualification of Broadcast Results.

## Bind the existing application ports

Replace the three unbound bindings in `server/existing-ports.ts` with calls to
the application's existing services. The shipped bindings throw fixed errors;
they do not authenticate anyone, commit a report, or grant a plan.

| Port                                             | Required existing authority                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireVerifiedSession()`                       | Verify the current session and active account authorization. Return stable application user/account IDs, the existing Fonte Contact ID, optional canonical source-party UUID, the existing membership observation UUID and its validity interval, and current explicit measurement permissions. |
| `saveReport({userId, accountId, report})`        | Authorize and commit the business transaction in the existing store. Return the committed business result and the stable observation UUID and real commit timestamp stored with that transaction. Reject if the transaction fails.                                                              |
| `commitPlan({userId, accountId, requestedPlan})` | Use the existing entitlement flow. Return its business result, the verified prior plan, actual effective plan/state, and stable committed observation UUID/timestamp. Reject failed transactions. A pending request is still pending.                                                           |

Preserve the host's existing session, request-origin/CSRF, account membership,
input validation, and error response policies when integrating the new action
and routes. A session-bound account must remain server-selected. Never accept
user IDs, Contact IDs, membership mappings, permissions, or plan truth from a
request body. The reference's narrow report parser is not the business store's
authorization or domain validation.

`sourcePartyId`, when supplied, is an already canonical commerce source-party
UUID for that relationship. Leave it absent/null when unknown. Do not create a
source party, Contact, or email-based identity graph to fill the field.

The membership UUID describes the existing verified relationship and its real
`validFrom`/`validUntil` authority. Its record has no `occurredAt`. Reusing a UUID
requires the same immutable observation body. If the host corrects or withdraws
a fact, use the SDK's separate retraction hook with a new UUID; do not overwrite
the old event under the old ID.

## Server initialization

Configure only the server runtime. These values must never use a
`NEXT_PUBLIC_` prefix or be passed to a client component, browser collector,
server-action argument, or serialized closure.

| Server variable                    | Value                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FONTE_SITE_ID`                    | The same existing Website site's ID.                                                                |
| `FONTE_APPLICATION_SOURCE_ID`      | The source ID from the application's server source configuration on that Website.                   |
| `FONTE_APPLICATION_SERVER_KEY`     | Its server credential, received through the existing authorized source configuration/rotation flow. |
| `FONTE_APPLICATION_ORIGIN`         | Exact registered application origin, such as `https://app.example.test`.                            |
| `FONTE_APPLICATION_POLICY_VERSION` | The configured policy version for this source.                                                      |
| `FONTE_API_ORIGIN`                 | Optional canonical API origin; omit for the SDK default `https://api.fonte.is`.                     |

The Core source configuration must select action `report_saved` and the
application's plan IDs `free` and `pro` with their actual server-owned ordering.
This reference uses those IDs explicitly; if the existing product has different
IDs, adapt those literals and Core configuration together. No client-supplied
plan ranks are emitted.

`server/source.ts` imports `server-only`, lazily constructs one source per server
process, and caches it. Missing or malformed measurement configuration returns
no source so existing business operations still run. Correct configuration and
restart the host to retry initialization. Configure the host through its existing
secret mechanism; the reference neither provisions nor rotates credentials.

All included handlers use the Node.js runtime. The SDK requires Node >=20.9 and
the installed Next.js version may impose a higher runtime floor. The application
export is not available to browser/Edge imports.

## Committed user journey

`journey.ts` is the shared wrapper used by the concrete App Router integration:

1. `app/account/page.tsx` verifies an existing session for each dynamic request
   and records an authenticated return/access with its existing relationship.
2. `app/reports/actions.ts` is a server action; `app/api/reports/route.ts` is a
   POST route. Both save through the existing authorized report store. Only after
   it commits do they synchronously record access, the existing relationship,
   and a successful `report_saved` action using the store's commit UUID/time.
3. `app/api/upgrade/route.ts` calls the existing entitlement store. An upgrade
   observation is emitted only for verified prior `free` to truly effective
   `pro`. Failed transactions propagate. Pending, unverified prior state,
   already-Pro, and unknown prior plans do not become effective upgrades.

Both activity and identity-link permissions must be explicitly `granted`. The
wrapper checks them before reading relationship or transaction observation
metadata or constructing the source. Denied/unknown permissions do not stop the
ordinary business operation. The existing store still uses its authorized
user/account IDs for that operation.

All observation hooks are synchronous memory operations. No business action or
route awaits `flush()`, and observation initialization/metadata failures are
contained without logging payloads or original exceptions. A store failure still
propagates unchanged before success observations. Fonte cannot turn a committed
report into an application failure.

Report titles and bodies stay in the existing store and application response.
They are not included in the application observation. Entitlement effectiveness
is a product-use fact; it does not establish a payment, amount, denomination,
collection date, refund, or payment-provider verification. Canonical commerce
has its own authoritative read path.

## Separate lifecycle delivery

The SDK schedules asynchronous bounded batches by itself. For a long-lived host
with an existing graceful-shutdown sequence, optional lifecycle work is:

```ts
// After the host stops admitting new work, before its process is terminated:
await drainApplicationObservations();
closeApplicationObservations();
```

The exports live in `server/source.ts`. Call them from the host's existing
lifecycle controller, outside business handlers. Do not expose a public drain
endpoint or install an unbounded `beforeExit` loop.

Delivery is **best effort**: a bounded in-memory queue has no disk outbox.
Process exit, suspended serverless instances, overflow, and a source denial can
lose unacknowledged observations. A lifecycle drain does not make serverless
delivery durable. A source 403/409 stops delivery and its sanitized status
describes the loss; it does not undo business success. Retry only preserves
immutable event UUIDs/bodies, and the SDK acknowledges success only after the
exact Core receipt confirms every submitted event. Fonte-ACK durability belongs
to Core.

## Local qualification

Build the SDK candidate packages, then run from the SDK repository root:

```sh
node --test tests/application-reference.test.mjs
node node_modules/typescript/bin/tsc -p examples/application-nextjs/tsconfig.json
```

The focused test compiles the actual reference wrapper with strict TypeScript,
uses the actual `@fonte-is/nextjs/application` server export, and sends batches
to a local HTTP receiver. It covers authenticated report success, returns,
explicit permission denial without observation reads, auth/business failures,
genuine versus pending/failed upgrades, stable UUID replay, outages/recovery,
source denial, and absence of fabricated payments.

The receiver supplies synthetic receipts to test SDK behavior. It is not Core
storage or provider proof. Core integration and independent Results qualification
must inspect source ingestion, Send-time custody, outcome calculation, customer
Results presentation, and the real deployment separately.

The example manifest references this checkout's Next.js SDK package. For an
isolated consumer build, pack the candidate Core/React/Next.js packages and
install those tarballs together in a disposable copy of the example, then run
its `build` command. The checkout's version label alone does not claim that its
new application export has been published to the registry. The reference stays
unbound until the host integrates its existing services.
