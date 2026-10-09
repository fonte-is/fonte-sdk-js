# Broadcast Results

This guide connects one real signed-in visit and one saved report to a
Broadcast. At the end, you can compare Fonte's Results with the user and
saved record your application already knows.

Already using PostHog? Use the [PostHog setup](./posthog-selected-actions.md)
for actions, and the browser visit example below for Returns.

## 1. Connect your app

Open **Fonte → Settings → Application**. Connect your application and add
`report_saved` as a successful action. You can select up to five actions.
Save the connection ID and one-time key in your server environment:

```text
FONTE_APPLICATION_SOURCE_ID=your-connection-id
FONTE_APPLICATION_SERVER_KEY=your-server-key
```

**Version 0.2 is a preview.** Install the explicit version:

```sh
npm install @fonte-is/core@0.2.0
```

Use Node.js 20.9 or later and ESM on the server. Create `fonte.ts`:

```ts
import { createFonte } from "@fonte-is/core/results";

export function createFonteClient() {
  return createFonte({
    installationId: process.env.FONTE_APPLICATION_SOURCE_ID!,
    serverKey: process.env.FONTE_APPLICATION_SERVER_KEY!,
  });
}
```

Your server authentication supplies the user's ID and verified email. Fonte
matches that email to a Broadcast contact after trimming and lowercasing it.
An unverified email cannot identify a recipient. A forwarded link does not
make its visitor the original recipient.

Use your application's existing measurement permission. A signed-in session
alone is not permission. If permission is denied or unknown, skip measurement.

## 2. Record the report after it saves

Create `save-report.ts` to wrap your existing authentication and save functions.
Connect `ReportApp` to those functions; do not accept the session, permission,
or commit receipt from the browser.

```ts
import type { AuthenticatedAppUser, Fonte } from "@fonte-is/core/results";

type ReportInput = { title: string };
type Session = {
  user: AuthenticatedAppUser;
  measurementAllowed: boolean;
};
type SavedReport = {
  report: { id: string; title: string };
  // null for a no-change save or a replay of a business operation.
  originalCommit: { operationId: string; committedAt: string } | null;
};
type ReportApp = {
  readSession(): Promise<Session | null>;
  saveReport(input: ReportInput, userId: string): Promise<SavedReport>;
  // Check the current actor and permission using your existing server state.
  canMeasure(userId: string): boolean;
};

export async function saveReport(
  input: ReportInput,
  app: ReportApp,
  fonte: Fonte,
) {
  const session = await app.readSession();
  if (!session) throw new Error("Sign in to save a report.");

  const user = session.user;
  const identity =
    session.measurementAllowed === true && app.canMeasure(user.id) === true
      ? fonte.identify(
          { id: user.id, email: user.email, emailVerified: user.emailVerified },
          { measurementAllowed: true },
        )
      : null;

  const saved = await app.saveReport(input, user.id);

  if (saved.originalCommit && app.canMeasure(user.id) === true) {
    identity?.trigger("report_saved", {
      eventId: saved.originalCommit.operationId,
      occurredAt: saved.originalCommit.committedAt,
    });
  }

  return saved.report;
}
```

For Next.js, call this wrapper from your existing route or server action.
It sends queued observations after the response, then closes this request's
client. Create `report-request.ts`:

```ts
import { after } from "next/server";
import { createFonteClient } from "./fonte.js";
import { saveReport } from "./save-report.js";

export async function saveReportInRequest(
  input: Parameters<typeof saveReport>[0],
  app: Parameters<typeof saveReport>[1],
) {
  const fonte = createFonteClient();
  try {
    return await saveReport(input, app, fonte);
  } finally {
    after(async () => {
      try {
        await fonte.flush();
      } finally {
        fonte.close();
      }
    });
  }
}
```

In a long-lived Node server, create one client at startup and pass it to
`saveReport()`. Keep every identity handle local to its own request and close
the shared client only when its lifecycle ends. Other serverless frameworks
need their equivalent of `after()`; do not close before delivery finishes.

Identify the user before the save, then call `trigger()` after the transaction
commits. If the save throws, the action is never called. Your save function
must check the user's access and return a commit receipt only for an actual
new saved change.

Use the operation's original UUID and UTC commit time, such as a stored
`Date.toISOString()` value. The report's ID is not the operation's ID: saving
the same report twice creates two operations. A delivery retry keeps the
original operation ID and time.

Map your authentication provider's user to exactly `{ id, email,
emailVerified }`. Passing the provider's entire user object adds fields the
SDK rejects. Discard the handle if the user or permission changes. It expires
after at most 15 minutes.

`trigger()` returns `true` when an event enters the local queue. Delivery
happens in the background; do not wait for Fonte before returning the saved
report. A failed delivery must not turn a successful save into an app error.

## 3. Record a signed-in visit

When serving a signed-in page, identify its current user as above and pass
only `identity.browserIdentity` to that user's page. Keep it in page memory.
Discard it on logout, account switching, or permission withdrawal.

Use this browser helper on a real visible page visit or navigation:

```ts
import {
  recordFonteReturn,
  type FonteBrowserIdentity,
} from "@fonte-is/core/results-browser";

export function recordVisit(
  identity: FonteBrowserIdentity | null,
  currentUserId: string | null,
  measurementAllowed: boolean,
) {
  if (
    !identity ||
    !currentUserId ||
    identity.userId !== currentUserId ||
    measurementAllowed !== true ||
    document.visibilityState !== "visible"
  )
    return false;

  return recordFonteReturn(identity);
}
```

The user and permission must come from your current signed-in state. Never
place the server key in the page or store the browser identity in logs,
cookies, or local storage. A background poll, timer, or `identify()` call
does not record a Return. A `true` result means delivery started, not that
Fonte has confirmed it.

For a server-rendered visit, `identity.returned()` is also available. Call it
only for actual authenticated foreground activity, with current permission.

## 4. Send once and check Results

Upload a contact you control and send them a real Broadcast. After sending,
sign in as that contact, visit a visible page, and save a changed report.
Read the saved report back from your application's normal interface before
checking the Broadcast's Results.

| What you independently verified                      | Expected Results                         |
| ---------------------------------------------------- | ---------------------------------------- |
| One recipient visited while signed in                | Returned: 1                              |
| That recipient saved a new report change             | `report_saved`: 1                        |
| They revisit or delivery retries                     | Still one person for each result         |
| A different, unmatched user opens the forwarded link | No attribution to the original recipient |
| The save fails or makes no change                    | No successful action                     |

Also try signing in directly without clicking the email. The authenticated
visit should still establish Return attribution for the matching contact.
Results count activity within seven days after the original send was accepted.
They do not establish that the Broadcast caused it.

If Results are missing, check the contact's verified email, current permission,
selected action key, and connection status. A delivery gap does not prove the
user did nothing. See the [delivery reference](./results-reference.md) before
retrying an old operation or testing restarts.

## Payments and existing integrations

Payment and refund Results require Fonte's verified Stripe connection and
actual provider records. A `purchase_completed` action cannot establish that
money was collected.

Existing integrations can keep the [Website API](./website-tracking.md) and
[application v1 API](./application-outcomes.md).
