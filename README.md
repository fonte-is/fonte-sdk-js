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

The package graph is deliberately small: `@fonte-is/core` owns browser capture, request validation, touch mapping, and server transport; `@fonte-is/react` adds lifecycle ergonomics; and `@fonte-is/nextjs` exposes the same server primitive for App Router installations. Evidence acceptance, attribution, and downstream decisions remain server authority.

All packages are ESM-only. Server entry points require Node.js 20.9 or newer.

Maintainers should read [the internal invariants](./docs/INTERNAL_INVARIANTS.md)
before changing identifier, delivery, origin, or lifecycle behavior.
