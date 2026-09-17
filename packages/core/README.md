# `@fonte-is/core`

Framework-neutral evidence collection. This candidate uses the versioned
`fonte.acquisition.v1` observation contract. It is not a production release.

```js
import { createCapture } from "@fonte-is/core";
const capture = createCapture({
  storage: "demo-site",
  collectionPolicy: () => readApprovedSitePolicy(),
});
await capture.page();
```

The installer supplies the actual configured collection policy. With no policy,
unknown/denied status, or an expired policy, capture performs no telemetry or
nonessential cookie/storage reads. A policy includes `version`, an absolute
`expiresAt` (timestamp or `null` for no automatic expiry), `storage` (`memory` or `persistent`), and `routes` (exact paths, `/section/*`, or `*`).
Click IDs, inherited ad cookies, source tokens, and enumerated campaign values
are separate opt-ins. Do not construct permission from a visitor's silence.
The server independently validates its policy, origin, route, and fields.

`page()` records one document/navigation occurrence. Repeated calls during that
occurrence do not resend. Call `page({navigation:true})` for a real same-URL
navigation; React bindings do this automatically. Page and source events have
distinct event IDs and share one occurrence ID. Count source events or distinct
occurrences, never both representations as independent acquisitions.

`retry()` replays frozen IDs, evidence, browser identity, and occurrence time.
There are at most 32 pending events per capture instance, three attempts per
event, a three-second request bound, and a 30-minute pending lifetime capped by
the original policy expiry. Pending observations are memory-only: they survive
storage failure within the document, not reloads. No cross-reload exactly-once
claim is made. No automatic retries or offline queue are installed.

`reset()` discards pending work and active browser continuity. Call it on
logout, identity switching, withdrawal, and unlink. Persistent continuity has
an absolute lifetime (`maxAgeDays`, default `null` for no automatic expiry), capped by policy expiry;
reading it does not refresh expiry. Explicit reset removes this installation's
stored continuity even in a fresh document. A browser ID is not a physical device, person, or account. Old
attribution caches are not reused as history.

`delivered` requires an explicit `accepted` or `duplicate_of_accepted` receipt
with the matching event ID, durable record ID, and durable receipt time.
Ignored, rejected, unavailable, and bare HTTP 2xx responses do not establish
custody. The server must enforce installation/environment-scoped idempotency
and reject conflicting observations. SDK tests alone cannot prove that server
property. Browser occurrence time remains reported, not trusted ordering.

Referrers retain only their origin; current URLs retain only an allowed route.
UTM values require an explicit value allowlist. Cookie history does not create
a new Meta encounter. X referrers use exact hostname boundaries. A presented
source token does not resolve or authenticate its issued placement; the
runtime must retain the versioned issued context separately.

`@fonte-is/core/server` exposes bounded parsing, scope minimization, and the
existing `/v1/touches` client. This SDK does not create a storage/identity
service, decide attribution, create contacts, bill, or export conversions.

`campaignValues: true` retains presented campaign fields without a predeclared
value list. Operators may instead supply an allowlist or omit the category.
These are installation choices, not a universal visitor-consent requirement.
