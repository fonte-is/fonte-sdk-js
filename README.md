# Fonte JavaScript SDK

Send a Broadcast to CSV contacts and see who returned and which useful actions followed.

The native Results API is a private qualification candidate, `0.2.0-fon909.1`.
Install the supplied private package artifact once. Public npm availability has
not been established for this candidate.

1. Upload your CSV in Fonte.
2. Install Fonte and keep its app connection ID and server key on your server.
3. Identify the current authenticated user using their verified email and your existing measurement permission.
4. Select up to five named successful actions, such as `project_created`, `report_saved`, and `invite_accepted`.
5. Optionally add verified Stripe payments and refunds when that connection is ready.
6. Send, then open the Broadcast's Results in Fonte.

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

Keep the returned handle local to this user's request. Record each action only
after its original successful commit, using that commit's UUID and UTC time.
The verified email must match a Contact in the uploaded CSV. Fonte delivery is
best effort; it must never hold up your business operation.

The [Results guide](./docs/results.md) covers action calls, authenticated visible
returns, the 15-minute handle and honest retry limits. An account upgrade can be
an optional named action; money requires verified provider evidence. The optional
PostHog shortcut is being prepared and has no released connection path yet.

All packages are ESM-only. Server entry points require Node.js 20.9 or newer.

Existing integrations retain the [Website/acquisition API](./packages/core/README.md#existing-websiteacquisition-api),
[application v1 adapter](./docs/application-outcomes.md), [React bindings](./packages/react/README.md)
and [Next.js bindings](./packages/nextjs/README.md).

Maintainers should read [the internal invariants](./docs/INTERNAL_INVARIANTS.md)
before changing identifier, delivery, origin, or lifecycle behavior.
