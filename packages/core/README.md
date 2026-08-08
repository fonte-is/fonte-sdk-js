# `@fonte-is/core`

Framework-neutral browser capture and server ingestion primitives for Fonte.

```sh
npm install @fonte-is/core
```

```js
import { createCapture } from "@fonte-is/core";

export async function startFonte() {
  const capture = createCapture({ storage: "my-app" });
  return capture.page();
}
```

`@fonte-is/core/server` contains the Node-only collection parser, origin gate,
touch mapper, and client for `POST /v1/touches`. Browser delivery status means
only that the configured application route returned a successful HTTP response.
Control Plane remains evidence-acceptance and attribution authority.
