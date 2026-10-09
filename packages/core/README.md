# Fonte Core

See which Broadcast recipients returned to your app and completed a successful
action, such as saving a report or accepting an invitation.

**0.2 is an unpublished preview.** When released, install the explicit version:

```sh
npm install @fonte-is/core@0.2.0
```

The release uses the `beta` tag. An unversioned install continues to use
the stable release. Server code requires Node.js 20.9 or later and ESM.

## Get started

1. Open **Fonte → Settings → Application**. Connect your app and choose up to
   five successful actions.
2. Save the connection ID and one-time key in your server environment.
3. Identify the signed-in user with their verified email and your existing
   measurement permission. Fonte matches that email to your Broadcast contacts.
4. Record an action after the save succeeds. Record a Return when the user
   visits a visible signed-in page.
5. Send to one controlled contact and check Results against the actual saved
   record.

```ts
import { createFonte } from "@fonte-is/core/results";

const fonte = createFonte({
  installationId: process.env.FONTE_APPLICATION_SOURCE_ID!,
  serverKey: process.env.FONTE_APPLICATION_SERVER_KEY!,
});
```

The [Results guide](https://github.com/fonte-is/fonte-sdk-js/blob/core-v0.2.0-preview.2/docs/results.md)
includes the complete server save and browser visit examples. Keep the server
key on your server. Each identity handle belongs to one authenticated user;
never share it as a global "current user."

Action calls queue locally and deliver in the background. A `true` return does
not mean Results have updated. Unconfirmed events are held in memory and can
be lost on restart. See the
[API and delivery reference](https://github.com/fonte-is/fonte-sdk-js/blob/core-v0.2.0-preview.2/docs/results-reference.md)
for retries and recovery.

## Carry actions through existing events

`identity.confirmTrigger()` signs an original saved action. Any event pipeline
can carry that confirmation in its metadata. Fonte verifies it using the same
identity, permission and Results rules as direct delivery. See the
[action confirmation guide](https://github.com/fonte-is/fonte-sdk-js/blob/core-v0.2.0-preview.2/docs/action-confirmations.md).

## Existing integrations

The Website and application v1 APIs remain available:

- [Website tracking](https://github.com/fonte-is/fonte-sdk-js/blob/core-v0.2.0-preview.2/docs/website-tracking.md)
  uses `@fonte-is/core` and `@fonte-is/core/server`.
- [Application v1](https://github.com/fonte-is/fonte-sdk-js/blob/core-v0.2.0-preview.2/docs/application-outcomes.md)
  uses `@fonte-is/core/application`.

All these guides are also included in the installed package's `docs` directory.
The package has no runtime dependencies and is licensed under Apache-2.0.
