# Use your existing PostHog events in Broadcast Results

Keep your existing PostHog project and event names. Choose the successful actions
you want to measure, add a small server confirmation to those captures, then see
which Broadcast recipients returned and took action.

## 1. Connect your project

Complete the [application setup](./results.md) so Fonte can identify your signed-in
users. Keep the Fonte server key in your server environment.

Open **Fonte → Settings → Plugins → PostHog → Connect PostHog**, choose your
project's cloud region and continue to PostHog to authorize the connection.
Return to Fonte and choose your existing project. You keep your current PostHog
SDK and capture configuration.

## 2. Choose events that mean a successful action

Select up to five existing events and give each a Fonte action key and a Results
label. For example:

| Existing PostHog event | Fonte action key | Results label  |
| ---------------------- | ---------------- | -------------- |
| `Report saved`         | `report_saved`   | Saved a report |

Choose events sent by your server after the real operation succeeds. Clicking
**Save** without saving a change must not produce this action.

Selecting an identified PostHog event is only part of setup. Fonte also needs the
server confirmation below: an event name, user property or `success: true` value
can be submitted without a real save.

## 3. Confirm the save in your existing capture

Use the `identity` from [identifying the signed-in user](./results.md). Create it
while handling the authenticated request, before the save. Its user ID must be
the same ID your existing capture uses for `distinctId`.

After the save commits, pass its original capture to the code below. Retain the
operation's original UUID and saved time. Run delivery in your framework's
supported work after the response; saving must not wait for Fonte or PostHog.

This Next.js example uses `after()`. Pass a request-local Fonte client and your
existing PostHog client. `canMeasureOriginalUser` must check your app's current
verified user and measurement permission for that person.

```ts
import { after } from "next/server";
import type { PostHog } from "posthog-node";
import type { Fonte, FonteIdentityHandle } from "@fonte-is/core/results";

type SavedCapture = Parameters<PostHog["capture"]>[0] & {
  distinctId: string;
  uuid: string;
  timestamp: Date;
};

export function sendSavedReportEvent(
  fonte: Fonte,
  identity: FonteIdentityHandle | null,
  posthog: PostHog,
  originalCapture: SavedCapture,
  projectId: string,
  canMeasureOriginalUser: (userId: string) => boolean | Promise<boolean>,
) {
  // Call only after the real changed save commits.
  after(async () => {
    try {
      if ((await canMeasureOriginalUser(originalCapture.distinctId)) !== true)
        return;
      await fonte.flush(); // Let Fonte confirm this specific signed-in identity.
      if ((await canMeasureOriginalUser(originalCapture.distinctId)) !== true)
        return;

      const confirmation = identity?.postHogWitness("report_saved", {
        projectId,
        event: originalCapture.event,
        eventId: originalCapture.uuid,
        occurredAt: originalCapture.timestamp.toISOString(),
      });

      // Remove any previous confirmation before adding this attempt's result.
      const properties = { ...originalCapture.properties };
      delete properties.fonte_commit;
      posthog.capture({
        ...originalCapture,
        properties: { ...properties, ...(confirmation ?? {}) },
      });
      await posthog.flush();
    } finally {
      fonte.close();
    }
  });
}
```

`projectId` is your selected PostHog project's numeric ID as a string. The
helper adds only `fonte_commit` metadata. Keep the existing event name, UUID,
`distinctId`, timestamp and other properties unchanged, and reserve that property
for Fonte. Do not call `identity.trigger()` as well for the PostHog-only path.

The helper produces confirmation only after Fonte has acknowledged this exact
identity. `flush()` returning or an HTTP success alone does not establish that
confirmation; the SDK checks it before returning metadata. If confirmation is
unavailable, your existing PostHog capture can still proceed. Fonte leaves the
action unmeasured. Failed or unchanged saves must never reach this code.

## 4. Check Broadcast Results

Save your selected events in Fonte and send a Broadcast with that action selected.
For a test with one real recipient, have them visit the app, sign in, make a real
changed save and reload the report to confirm it persisted.

Check the PostHog capture and its destination delivery, then open Broadcast
Results. For this successful one-person journey, expect **Returned: 1** and
**Action: 1**. Fonte matches the actual signed-in person using their verified
email; forwarding a link does not identify them as the original recipient.

The PostHog connection shows **Verification required** until a selected action
reaches Fonte successfully, then **Verified action received**. A configured
connection alone does not prove the action worked. Repeat the save with a failed
write and confirm it adds no Action; retry the same saved operation and confirm
it adds no duplicate.

## Retries, downtime and settings changes

Retry an original operation with its same UUID, time and verified sign-in facts.
Do not replace them with the time of the retry or a later login. An action must
have happened within its original sign-in's fifteen-minute measurement interval.
When your existing business receipt retains those original facts, a trusted
server can recover delivery after a restart or outage within thirty days. Check
the current user and permission again, obtain Fonte's acknowledgement of the
original identity, and resend the same original capture. Missing or erased
evidence leaves the action unmeasured. The SDK provides no persistent store or
automatic recovery without your application's retry or readback.

Recovery preserves the original save time. It does not extend the Broadcast's
seven-day attribution window.

Recovery cannot renew browser Return or authorize a new action using an expired
identity. Never sign an old PostHog record using a later login. Native and PostHog
copies of the same original action are deduplicated by Fonte.

Disconnects, key rotation, withdrawn permission and changed settings can reject
older confirmations. The next acknowledged identity uses the current settings;
you do not need to redeploy a revision number after editing a label. PostHog's
realtime destination is best effort, so a missing delivery does not prove the
recipient did nothing.

See the [Results reference](./results-reference.md) for acknowledgement, timing,
privacy and delivery details. PostHog documents its
[webhook destinations](https://posthog.com/docs/cdp/destinations/webhook) and
[destination delivery behavior](https://posthog.com/docs/cdp/destinations).
