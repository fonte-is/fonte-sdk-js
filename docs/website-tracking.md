# Website tracking

This guide covers the existing `@fonte-is/core` Website API. To measure
signed-in visits and saved actions after a Broadcast, use the
[Results guide](./results.md).

## Record a page visit

Use the collection policy configured for your site:

```js
import { createCapture } from "@fonte-is/core";

const capture = createCapture({
  storage: "demo-site",
  collectionPolicy: () => readApprovedSitePolicy(),
});

await capture.page();
```

`readApprovedSitePolicy()` represents your site's existing policy authority;
the SDK does not decide permission. Without a valid policy, or when its
status is unknown, denied, or expired, capture performs no telemetry or
nonessential cookie or storage reads.

A policy includes `version`, an absolute `expiresAt` (a timestamp, or `null`
for no automatic expiry), `storage` (`memory` or `persistent`), and `routes`
(exact paths, `/section/*`, or `*`). Click IDs, inherited ad cookies, source
tokens, and campaign values are separate opt-ins. Do not infer permission
from a visitor's silence. The server independently checks policy, origin,
route, and fields.

`page()` records one document or navigation occurrence. Repeating it for
that occurrence does not send it again. Use `page({ navigation: true })` for an
actual same-URL navigation; the React bindings do this automatically.

Page and source events have different event IDs and share an occurrence ID.
Count source events or distinct occurrences, not both as separate arrivals.

## Retry and reset

`retry()` replays the original IDs, evidence, browser identity, and occurrence
time. Each capture instance retains at most 32 pending events, with three
attempts per event and a three-second request bound. Pending events expire
after 30 minutes or at the original policy expiry, whichever comes first.

Pending events stay in memory. They survive a storage failure within the
document but not a reload. There is no automatic retry or offline queue,
and no guarantee of exactly-once delivery across reloads.

Call `reset()` on logout, identity switching, withdrawal, or unlink. It
discards pending work and active browser continuity, including this
installation's stored continuity from a previous document. Persistent
continuity has an absolute lifetime (`maxAgeDays`, default `null`), capped
by policy expiry. Reading it does not extend its lifetime. A browser ID
does not identify a person, account, or physical device.

## What a delivery receipt means

The `delivered` result requires `accepted` or `duplicate_of_accepted` with
the matching event ID, durable record ID, and receipt time. Ignored,
rejected, unavailable, or bare HTTP success responses do not confirm storage.

The server must enforce idempotency within the installation and environment
and reject conflicting observations. Browser occurrence time is reported
evidence, not authoritative ordering. The contract is `fonte.acquisition.v1`.

## Collected fields

Referrers retain only their origin, and current URLs retain only an allowed
route. Campaign values require a configured allowlist or the explicit
`campaignValues: true` option. Omitting the category collects none of them.
These are installation choices; they do not establish visitor permission.

Cookie history does not create a new Meta encounter. X referrers use exact
hostname boundaries. A presented source token does not authenticate its
issued placement; the runtime must retain that versioned context separately.
Old attribution caches are not reused as history.

`@fonte-is/core/server` provides bounded parsing, scope minimization, and the
existing `/v1/touches` client. Contact creation, identity decisions, billing,
and conversion exports remain in their existing services.

The [application v1 adapter](./application-outcomes.md) is also retained for
existing integrations.
