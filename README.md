# Fonte JavaScript SDK

Public JavaScript packages for installing Fonte in browser, React, and Next.js applications.

```sh
npm install @fonte-is/core
```

```js
import { createCapture } from "@fonte-is/core";

export async function startFonte(collectionPosture) {
  const capture = createCapture({
    storage: "my-app",
    collectionPosture,
  });
  return capture.page();
}
```

Browser capture requires the versioned collection-posture receipt supplied by the
application. Missing or unusable posture returns typed `unavailable` deliveries
without contacting the collection route. Delivery results distinguish
`delivered`, `skipped`, `failed`, `unavailable`, and `withheld`; their reason
describes local delivery or collection-policy handling, not evidence acceptance.

The package graph is deliberately small: `@fonte-is/core` owns browser capture, request validation, touch mapping, and server transport; `@fonte-is/react` adds lifecycle ergonomics; and `@fonte-is/nextjs` exposes the same server primitive for App Router installations. Evidence acceptance, attribution, and downstream decisions remain server authority.

All packages are ESM-only. Server entry points require Node.js 20.9 or newer.

Maintainers should read [the internal invariants](./docs/INTERNAL_INVARIANTS.md)
before changing identifier, delivery, origin, or lifecycle behavior.
