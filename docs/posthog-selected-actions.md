# Selected backend PostHog actions

Fonte can use the application's existing PostHog action events with the same
native installation, authenticated identity and Results engine. Configure up to
five existing event names and their Fonte action keys on the installation.
PostHog sends those events through its supported realtime HTTP destination.
Native signed-in Return works independently.

The application must add a small proof to each selected backend event **after
the successful operation commits**. PostHog's public capture token admits
client-authored events, so identified/profile/success properties alone cannot
prove a committed action. This helper uses the existing Fonte installation key.
It adds no key, authentication system, provider SDK or native action delivery.

Use the same request-local `identity` returned by
`createFonte(...).identify(...)` in the [native Results setup](./results.md).
Supply the actual authenticated user from the application's trusted session,
explicit measurement permission, and its existing verified email. Keep the
installation key on the server.

```ts
// In the existing measurement lifecycle callback, outside the successful response:
// The application's real save has already committed with its original operation ID/time.
await fonte.flush();
const witness = identity?.postHogWitness("report_saved", {
  projectId: "123",                  // Selected PostHog project, from setup
  event: originalPostHogCapture.event,
  eventId: originalPostHogCapture.uuid,
  occurredAt: originalPostHogCapture.timestamp.toISOString(),
});
existingPostHog.capture({
  ...originalPostHogCapture,
  properties: { ...originalPostHogCapture.properties, ...(witness ?? {}) },
});
```

The original capture must already describe the genuine committed operation,
use the authenticated user's same `id` as its `distinctId`, and retain the
durable operation UUID/time. Failed operations must not call this helper.
`postHogWitness` returns only frozen `{fonte_commit}` metadata. It changes no
existing event name, UUID, distinct ID, timestamp or properties, and enqueues no
native Action. If Fonte is unavailable, the existing PostHog capture can proceed
without the proof; Fonte withholds conversion rather than fabricating success.
The older `postHogTrigger` method still returns the full compatible capture
input when that is convenient.

The provider's original UUID and distinct ID must match the proof. It contains
the native action, original identity witness and original occurrence time, with
no email or installation key. Adding existing safe PostHog properties does not
make those properties part of Fonte's admitted payload.

This method is synchronous and returns `null` for invalid input, denied or
closed measurement, an expired identity handle, or an identity without its exact
stored/replayed native acknowledgement. It never throws into the
successful application operation. Capture the native identity early in the
request; use the ordinary SDK lifecycle drain outside the successful business
transaction. The helper uses the Source revision from that identity's validated
native ACK; missing, malformed, erased or failed ACKs produce no proof. The
ordinary strict receipt JSON is unchanged; revision is nonsecret HTTP metadata.
Only the exact source and identity event's successful ACK can update its handle.
Do not await measurement in a successful business transaction.

Preserve the complete original capture input for retries. Reuse the operation's
UUID, time and identity witness. A new UUID is a new observation; a later login
must not retroactively prove an older action. The original identity is valid for
at most fifteen minutes. Accepted events can arrive later within Fonte's
existing thirty-day recovery bound; they retain their original action time.

Fonte verifies the current installation credential, selected project, exact
event mapping and Source revision. Rotation, disconnect, withdrawn permission
or configuration changes fence stale delivery. The next native identity ACK
automatically supplies the current revision after settings change, including a
label-only edit. No application revision setting needs redeploying. The optional
`sourceRevision` input is only a compatibility assertion; a value different from
that identity's ACK is rejected. Previously captured old proofs stay fenced.
Previously accepted native and
PostHog copies of the same operation use the same existing deduplication key.

The destination forwards only the closed payload
`{schema,sourceId,projectId,eventId,event,userId,commitProof}` to
`POST /v1/application-posthog-observations`. The existing signed proof
authenticates the exact action with the private Source verifier; the destination
needs no copy of the application key or installation headers. Legacy headers
remain supported when both are valid. Disable debug logging and do not export
person profiles or arbitrary event properties.

Realtime destination coverage is best effort. Missing deliveries, provider
quarantine and disconnected periods do not establish zero activity. This adapter
does not poll `/query` or promise a provider history cursor.

Connect your existing project in **Fonte → Settings → Plugins → PostHog**,
select successful-action events, and verify a new committed action in Broadcast
Results. Official provider references:
[webhook destinations](https://posthog.com/docs/cdp/destinations/webhook),
[capture authentication](https://posthog.com/docs/api),
[destination delivery caveats](https://posthog.com/docs/cdp/destinations).

The ordinary PostHog connection must distinguish authorization, event selection
and backend action verification. Selecting an existing identified event is not
enough to establish a successful action: this small server installation step is
required. Old captured records must not be retroactively signed. Verify with a
new genuine committed action, its actual provider capture/delivery and the
independently expected Results, then repeat the adverse cases.
