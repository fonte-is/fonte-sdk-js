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
// After the application's real save succeeds, using its original operation ID/time:
const capture = identity?.postHogTrigger("report_saved", {
  projectId: "123",                  // Selected PostHog project, from setup
  event: "Report saved",             // Existing selected backend event name
  sourceRevision: installationRevision,
  eventId: committedOperation.eventId,
  occurredAt: committedOperation.occurredAt,
});
if (capture) existingPostHog.capture(capture);
```

`capture` contains the existing provider capture fields `event`, `uuid`,
`distinctId`, `timestamp` (a `Date`) and a `properties.fonte_commit` proof.
The provider's original UUID and distinct ID must match that proof. It contains
the native action, original identity witness and original occurrence time, with
no email or installation key. Adding existing safe PostHog properties does not
make those properties part of Fonte's admitted payload.

This method is synchronous and returns `null` for invalid input, denied or
closed measurement, or an expired identity handle. It never throws into the
successful application operation. Capture the native identity early in the
request; use the ordinary SDK lifecycle drain outside the successful business
transaction. Fonte requires that exact native identity to reach durable custody
before the provider action can qualify. A provider delivery arriving first is
denied and needs the provider's bounded retry or replay after the identity ACK.
Do not await measurement in a successful business transaction.

Preserve the complete original capture input for retries. Reuse the operation's
UUID, time and identity witness. A new UUID is a new observation; a later login
must not retroactively prove an older action. The original identity is valid for
at most fifteen minutes. Accepted events can arrive later within Fonte's
existing thirty-day recovery bound; they retain their original action time.

Fonte verifies the current installation credential, selected project, exact
event mapping and Source revision. Rotation, disconnect, withdrawn permission
or configuration changes fence stale delivery. After configuration changes,
use the new revision for subsequent actions. Previously accepted native and
PostHog copies of the same operation use the same existing deduplication key.

The destination forwards only the closed payload
`{schema,sourceId,projectId,eventId,event,userId,commitProof}` to
`POST /v1/application-posthog-observations`, using the existing installation
headers. Store the key in a provider input marked secret and disable debug
logging. Do not export person profiles or arbitrary event properties.

Realtime destination coverage is best effort. Missing deliveries, provider
quarantine and disconnected periods do not establish zero activity. This adapter
does not poll `/query` or promise a provider history cursor.

The Core adapter and this SDK helper require deployment/publication before
customer use. A real project grant, destination secret custody, first-time setup
and the complete ordinary customer PostHog journey remain separate qualification
steps. Official provider references:
[webhook destinations](https://posthog.com/docs/cdp/destinations/webhook),
[capture authentication](https://posthog.com/docs/api),
[destination delivery caveats](https://posthog.com/docs/cdp/destinations).
