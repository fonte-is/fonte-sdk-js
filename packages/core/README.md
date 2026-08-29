# `@fonte-is/core`

Framework-neutral browser capture and server ingestion primitives for Fonte.

```sh
npm install @fonte-is/core
```

```js
import { createCapture } from "@fonte-is/core";

export async function startFonte(collectionPosture) {
  const capture = createCapture({ storage: "my-app", collectionPosture });
  return capture.page();
}
```

`@fonte-is/core/server` contains the Node-only collection parser, origin gate,
touch mapper, and client for `POST /v1/touches`. Browser delivery status means
only that the configured application route returned an accepted, withheld, or
unavailable receipt. Read `client.collectionPosture()` on the server and expose
only that non-secret runtime receipt to `createCapture`; tenant credentials stay
server-side. For consent-managed collection, supply the site's observed visitor
choice without deriving it on the server. Control Plane remains
evidence-acceptance and attribution authority.

Browser retry state is deliberately narrow:

- `storage` is an installation-scoped namespace. Do not share it across
  unrelated collectors.
- `collect` must be a same-origin application path; browser code never receives
  the trusted server's tenant credential.
- `page()` observes the current page and never implicitly resends pending work.
  `retry()` is the explicit ambiguous-result retry boundary.
- Reusing an `eventId` and `occurredAt` during retry is best-effort browser
  convenience only. The memory fallback lasts only the current page lifetime.
  `sessionStorage` is not durable authority or cross-reload exactly-once proof.
