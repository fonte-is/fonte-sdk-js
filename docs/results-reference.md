# Results API and delivery reference

Start with the [setup guide](./results.md) or
[action confirmation guide](./action-confirmations.md). This page covers the API,
delivery limits, and recovery of an original saved action.

## Server API

Import from `@fonte-is/core/results`. Keep this entry point and the server key
out of browser bundles.

| Call                                                    | Use                                                        | Return value                                |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `createFonte({ installationId, serverKey })`            | Create the server client                                   | A client; invalid configuration throws      |
| `fonte.identify(user, { measurementAllowed: true })`    | Identify the current authenticated user                    | An identity handle, or `null` when rejected |
| `identity.trigger(key, { eventId, occurredAt })`        | Report an original committed action                        | `true` when queued locally                  |
| `identity.returned({ eventId, occurredAt })`            | Report authenticated foreground activity                   | `true` when queued locally                  |
| `identity.browserIdentity`                              | Supply short-lived identity to the same user's page        | Browser identity, or `null`                 |
| `identity.confirmTrigger(key, { eventId, occurredAt })` | Confirm an original committed action for external delivery | An opaque signed string, or `null`          |
| `fonte.retract(input, { measurementAllowed: true })`    | Correct or withdraw an original observation                | `true` when queued locally                  |
| `fonte.status()`                                        | Inspect delivery state without private payloads            | Delivery status                             |
| `fonte.flush()`                                         | Drain in a supported background or process lifecycle       | A promise of delivery status; never rejects |
| `fonte.close()`                                         | End this client and discard pending work                   | Delivery status                             |

`user` contains exactly `{ id, email, emailVerified }`. Verification and
measurement permission come from your existing server authorities. Each
handle belongs to that user's request; never keep a shared mutable current
user. Recheck current identity and permission before later activity.

`confirmTrigger()` requires explicit original `eventId` and `occurredAt`. Its
opaque string can travel through any event metadata. It does not enqueue an
action or prove delivery. Fonte must first acknowledge that exact identity
with a stored or replayed disposition and its Source revision. An optional
`sourceRevision` is an assertion of that acknowledged revision, not an override.
The method cannot discover a later session or permission change in your app.

## IDs and times

- User and installation IDs accept 1–200 letters, digits, `_`, `.`, `:`, or `-`.
- Event IDs are UUIDs, versions 1–5. Retries keep the original event ID.
- Times are UTC ISO strings ending in `Z`, such as `Date.toISOString()`.
  Intake allows at most 30 days in the past and five minutes in the future.
- Action keys start with a lowercase letter and contain lowercase letters,
  digits, or underscores, up to 64 characters. Configure the same keys in Fonte.
- `identify()` accepts optional `eventId`, `occurredAt`, and `validUntil`.
  Identity validity must be positive and no longer than 15 minutes.

Defaults generate a fresh UUID and current time. Supply the application's
original operation UUID and commit time for actions that need safe replay.
A new occurrence needs a new ID; a delivery retry must not create one.

## Browser Returns

Import `recordFonteReturn` from `@fonte-is/core/results-browser`. It records
one real visible visit using a current `FonteBrowserIdentity`. Its `true`
return means delivery started, not that a durable receipt was confirmed.

The browser identity is short-lived bearer data. Keep it in that user's page
memory. Do not log or persist it. Clear it on logout, account switching, or
permission withdrawal. Expired identities, background pages, and mismatched
identities cannot establish a Return.

## Queues and acknowledgements

Delivery is best effort. Events stay in memory until Fonte acknowledges them.
There is no disk queue or automatic recovery after process restart. Exit,
redeploy, overflow, `close()`, or blocked authorization can lose events that
Fonte has not confirmed.

The server queue holds at most 1,000 records. Delivery sends at most 100
records and 64 KiB per request, with one active request. Requests are bounded
to 750 ms and up to three attempts per cycle. Custom `fetch` implementations
must honor their AbortSignal. Redirects are refused and cookies are omitted.

An acknowledgement must name the exact source and every submitted UUID with
a stored, replayed, or erased disposition. A bare HTTP success or lost
acknowledgement does not confirm receipt. Retries preserve the original IDs,
payloads, and clocks.

After exhausted retries, another enqueue or `flush()` can start a new bounded
cycle. A valid Retry-After of up to one day is honored. A cooldown over two
seconds ends the current flush; call it again after the reported cooldown.
HTTP 403 or 409 blocks the client and discards pending work. Fix the
configuration or conflict before creating a replacement client.

`status()` contains counts, queue size, delivery state, cooldown, and a fixed
reason code. It excludes credentials, identities, record IDs, and payloads.
The initial local `ready` state does not prove the connection is working.
Missing observations mean coverage may be incomplete, not that the user was
inactive.

Do not await `flush()` in the successful save or payment operation. Use your
framework's supported background lifecycle when needed. `close()` aborts
delivery and discards the remaining queue. Stop the relevant client when
installation-wide permission is withdrawn.

## Recover an original action after a delay or restart

Recovery is possible only if your application already retained the original
business receipt and its original verified identity. It does not add storage
or invent missing facts.

1. Reverify the current actor and measurement permission through your app.
2. Load the original verified user, identity UUID, observed time, and validity
   interval from your existing records. Load the original action UUID and
   commit time. If this evidence is missing or erased, withhold the action.
3. Call `identify()` with those exact original identity fields. Confirm that
   Fonte stored or replayed that identity in a supported background lifecycle.
4. Replay the original action with its original UUID and time using
   `trigger()`, or carry `confirmTrigger()` with its original external event.

The action must have happened inside the original identity's validity
interval and remain within the 30-day intake limit. The current installation,
key, selected action, and permissions still govern acceptance.
Action confirmation requires that exact identity's stored or replayed
acknowledgement and acknowledged source revision.

Calling default `identify()` creates a new identity ID. Reusing an old action
ID under this new identity is a conflicting record. Never replace the
original identity with a later login, reset the action clock, or attach
confirmation to a provider event without its genuine saved operation.

The 30-day intake limit does not extend the Broadcast's attribution window.
Results count activity after the original send acceptance and within seven
elapsed days. A day-two save recovered on day twenty can still qualify under
the current identity, permission, and connection checks. A day-eight save is
outside that Broadcast's window even if its delivery succeeds.

Recovering an original fact does not renew the identity's authority for new
actions or browser visits. Those still expire after at most 15 minutes.

## Corrections and withdrawals

Use `retract()` with a new event UUID, the original `targetId`, and a reason
of `correction` or `withdrawn`. Provide current measurement permission.
Do not change a previously submitted event under its existing ID.

Payments and refunds remain governed by verified payment-provider records;
an action or retraction is not a payment receipt.
