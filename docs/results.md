# Broadcast Results

Upload CSV → install Fonte once → identify the current authenticated user → add
up to five successful actions → optionally add money → Send → trustworthy Results.

The native API is a private qualification candidate, `0.2.0-fon909.1`. Install
the supplied private `@fonte-is/core` artifact. Public npm availability has not
been established for this candidate. Server code requires Node.js 20.9 or later.

## Set up once

Upload your recipient CSV in Fonte. Add your app connection, choose the actions
you care about, and save the connection ID and server key in your server
environment. Create one Fonte client there. Your app keeps its existing
authentication and permissions.

Identify the current authenticated user for each request that you measure. Use
the verified email supplied by your authentication provider. Fonte matches
that address exactly to a CSV Contact after email normalization. An unverified
or unmatched user cannot establish a measured recipient.

```ts
import { createFonte, type AuthenticatedAppUser } from "@fonte-is/core/results";

const fonte = createFonte({
  installationId: process.env.FONTE_APPLICATION_SOURCE_ID!,
  serverKey: process.env.FONTE_APPLICATION_SERVER_KEY!,
});

export function identifyAuthenticatedRequest(
  user: AuthenticatedAppUser,
  existingServerPermission: boolean | null | undefined,
) {
  if (existingServerPermission !== true || user.emailVerified !== true) return null;
  return fonte.identify(
    { id: user.id, email: user.email, emailVerified: user.emailVerified },
    { measurementAllowed: true },
  );
}
```

`user` and `existingServerPermission` come from the current request's existing
server authorities. Pass `true` only for a real affirmative measurement grant;
denied or unknown permission withholds the observation. Authentication alone
does not grant measurement permission.

The returned handle belongs only to this authenticated user. Its original
authentication witness covers at most 15 minutes of actions. Keep the handle
local to the request or its supported response lifecycle.
Discard it when the user changes, logs out or withdraws permission. Never keep
a shared mutable current-user handle.

## Record the successful actions you care about

Configure the same action keys in Fonte and in your app. Three ordinary examples:

| Action key | Call after |
| --- | --- |
| `project_created` | A new project is actually committed |
| `report_saved` | A report change is actually saved |
| `invite_accepted` | An invitation is actually accepted |

Create the handle while handling this authenticated request, before the useful
action commits. Call the hook only for the original successful commit. A failed
operation, no-change result, business replay, status read or background job
does not establish another successful user action.

```ts
import type { FonteIdentityHandle } from "@fonte-is/core/results";

type UsefulAction = "project_created" | "report_saved" | "invite_accepted";
type OriginalCommit = { operationId: string; committedAt: string };

export function recordSuccessfulAction(
  handle: FonteIdentityHandle | null,
  action: UsefulAction,
  committed: OriginalCommit,
) {
  return handle?.trigger(action, {
    eventId: committed.operationId, // The original committed UUID.
    occurredAt: committed.committedAt, // The original UTC commit time.
  }) ?? false;
}
```

Use the UUID and timestamp already owned by that operation. UTC timestamps such
as a stored `Date.toISOString()` value are accepted. Repeated occurrences have
different original UUIDs, while retries of one occurrence keep its UUID and
time unchanged. A `true` return means the record was enqueued locally; it does
not prove that Fonte received it. Return your business result without waiting
for Fonte delivery.

If your own account system has a genuine completed upgrade, you may configure
an ordinary successful action such as `upgrade_completed`. Optional upgrade
measurement uses your existing authoritative success receipt. Money is measured
separately through the payment provider.

## Measure an authenticated return

`handle.returned()` is for real authenticated foreground activity. Identify
alone, timers, background requests and status polling do not prove a return.
Recheck current permission before using a handle for a later activity.

For a visible authenticated browser page, pass only this request's
`handle.browserIdentity` to that same user's page. Keep it in page memory and
discard it on logout, identity switching or permission withdrawal. Do not put
the server key or server client in the browser, or log/persist the browser
identity.

```ts
import { recordFonteReturn, type FonteBrowserIdentity } from "@fonte-is/core/results-browser";

export function observeVisibleAuthenticatedPage(
  identity: FonteBrowserIdentity | null,
  isCurrentlyAuthenticated: boolean,
  existingMeasurementPermission: boolean | null | undefined,
) {
  if (
    !isCurrentlyAuthenticated ||
    existingMeasurementPermission !== true ||
    !identity ||
    document.visibilityState !== "visible"
  ) return false;
  return recordFonteReturn(identity);
}
```

Call this for a real page visit or foreground navigation, with current
permission and the correct current user's browser identity. It starts best
effort delivery. It cannot prove a durable receipt to your browser code.

## Optional money, then Send and Results

Money comes from Fonte's authoritative Stripe payment/refund connection when
that connection is verified and available. These SDK calls never report money
collected or refunded. A purchase-shaped action name cannot establish a payment.
During qualification, leave money unavailable until the provider proof exists.

Send your Broadcast normally and open its Results in Fonte. Results show which
CSV Contacts returned, which performed each configured successful action, and
what verified money was collected or refunded when available. Repeated events
do not turn one Contact into several people. Actions are observed after Send;
this does not assert that the Broadcast caused them.

Use the [repeatable customer journey](./results-journey.md) to compare real
sign-in and committed actions with independently frozen Results, then repeat
direct returns, wrong users, failed actions and delivery/restart cases.

The optional PostHog shortcut is being prepared. There is no released Connect
PostHog path in this candidate, and existing identified events are not already
qualified by this SDK guide.

## Capture and retry limits

Capture is best effort until Fonte durably acknowledges it. Delivery uses a
bounded in-memory queue and bounded retries. Process exit, redeploy, overflow,
explicit close or denied authorization can lose unacknowledged observations.
The SDK adds no persistent outbox and makes no cross-restart delivery guarantee.

SDK transport retries preserve exact identity and action IDs, payloads and
original clocks. An application can retain its original verified authentication
witness with the existing durable business receipt and retry that same committed
fact after restart. Reverify the current actor and measurement permission, then
use `identify()` with the original identity UUID, observed time and validity
interval. After that exact identity's stored/replayed ACK, server `trigger()`
can replay an explicitly supplied original action UUID/time within the existing
30-day intake bound. The action must have occurred inside the original witness
interval. No new login, ID or clock can retroactively prove an older action.

A default `identify()` normally creates a new identity ID; reusing an action
UUID under that different witness is a conflicting record. The SDK adds no
persistent store or automatic restart recovery. The application must already
own the original facts; missing or erased evidence must withhold the conversion.
Current actions, browser Return authority and new PostHog proof generation still
expire after 15 minutes. A late native replay grants none of those capabilities.

`fonte.status()` reports bounded delivery state without private payloads. A
disconnected or incomplete source means coverage is incomplete; a missing
observation is not proof that a customer did nothing. `fonte.flush()` is an
optional separate supported lifecycle drain. Never await it in the successful
business operation. `fonte.close()` discards queued work; use it when ending
the client lifecycle or stopping the whole installation.

Existing integrations can continue using the separately documented
[Website/acquisition API](../packages/core/README.md#existing-websiteacquisition-api)
and [historical application v1 API](./application-outcomes.md).
