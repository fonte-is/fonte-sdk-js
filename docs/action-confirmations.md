# Carry a saved action through an existing event

Use `identity.trigger()` to send a saved action directly to Fonte. Use
`identity.confirmTrigger()` when an existing event pipeline will deliver that
same action. Both use the same identity, permission and Broadcast Results rules.

A confirmation is a signed string. It binds your connection, its acknowledged
revision, the original authenticated user and the successful action's UUID,
key and commit time. The SDK does not choose a service or construct its events.

## Confirm after the save

Follow the [Results setup](./results.md) to connect your application and identify
its signed-in user before the save. Keep the identity handle local to that
request. Your server must independently know that the operation committed.
A button click or optimistic event is insufficient.

Call `confirmTrigger()` in your framework's supported background lifecycle
after Fonte has acknowledged that exact identity. The save response must not
wait for Fonte or the event pipeline.

This example attaches confirmation to an event your application already emits.
`canMeasureOriginalUser` checks the current actor and permission against your
existing server state. The event's ID and time come from the committed operation.

```ts
import type { Fonte, FonteIdentityHandle } from "@fonte-is/core/results";

type SavedEvent = {
  id: string;
  actorId: string;
  occurredAt: string;
  name: string;
  metadata: Readonly<Record<string, unknown>>;
};

export async function publishSavedEvent(
  fonte: Fonte,
  identity: FonteIdentityHandle | null,
  event: SavedEvent,
  canMeasureOriginalUser: (userId: string) => boolean,
  publish: (event: SavedEvent) => Promise<void>,
) {
  const metadata = { ...event.metadata };
  delete metadata.fonte_commit;

  await fonte.flush();
  if (canMeasureOriginalUser(event.actorId) === true) {
    const confirmation = identity?.confirmTrigger("report_saved", {
      eventId: event.id,
      occurredAt: event.occurredAt,
    });
    if (confirmation) metadata.fonte_commit = confirmation;
  }

  await publish({ ...event, metadata });
}
```

The identity handle must belong to `event.actorId`, using the original verified
session from that operation. Keep the event's existing name, actor, UUID and
time. `fonte_commit` is a metadata convention; the confirmation itself is
independent of the carrier. Treat it as private measurement data and avoid logs.
Close a request-local Fonte client only after its background work finishes.

`confirmTrigger()` returns `null` when that identity has not been acknowledged,
the client is blocked or closed, or the original event is invalid. The caller
must check current permission; the synchronous method cannot read your app's
session or a later permission withdrawal. Your existing event can still
proceed without the confirmation.
Fonte cannot count an unconfirmed action. The method does not enqueue a native
action or report delivery success.

## Deliver to Fonte

A connected event source passes the confirmation and its actual event UUID and
authenticated user ID to Fonte. It does not need your server key. Fonte verifies
the signature, current connection revision and permissions, then checks the
original stored identity before admitting the action to the existing Results
engine. An integration's selected-event mapping must also match the action.

The public endpoint is `POST https://api.fonte.is/v1/application-observations`
with `Content-Type: application/json` and this closed envelope:

```json
{
  "schema": "fonte.trigger.observation.v1",
  "sourceId": "your-connection-id",
  "eventId": "123e4567-e89b-42d3-a456-426614174000",
  "userId": "your-authenticated-user-id",
  "confirmation": "the-original-signed-confirmation"
}
```

Use the event's real UUID and authenticated user ID, unchanged. Never invent
them from a link or browser field. A valid signature confirms your server's
assertion; it is not proof that Fonte has accepted the action. Current privacy,
retraction and connection checks still govern admission.

Changing the actor or event UUID invalidates admission. Changing the action,
its key or time invalidates the signature. Repeating the same action through
direct delivery and an external event does not create a second action.

## Verify and recover

Read the saved operation back through your application's normal interface,
then compare its user and commit time with Broadcast Results. Repeat with a
different user, failed save and duplicate delivery. They must not produce a
false action or increase a person's count.

For a delayed delivery, retain the same confirmation and original event facts.
After a restart, recovery requires the original verified identity and committed
operation from your application's existing storage. Replay that identity and
obtain its exact acknowledgement before confirming the original action again.
Do not substitute a later login or reset the action clock. See the
[recovery reference](./results-reference.md#recover-an-original-action-after-a-delay-or-restart).

Intake permits up to 30 days of recovery. Broadcast attribution still ends
seven elapsed days after the original send acceptance; recovery uses the
original commit time.
