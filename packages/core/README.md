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
