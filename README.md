# Fonte JavaScript SDK

Public JavaScript packages for installing Fonte in browser, React, and Next.js applications.

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

The package graph is deliberately small: `@fonte-is/core` owns browser capture, request validation, touch mapping, and server transport; `@fonte-is/react` adds lifecycle ergonomics; and `@fonte-is/nextjs` exposes the same server primitive for App Router installations. Delivery results report only whether the configured application route responded successfully. Evidence acceptance, attribution, and downstream decisions remain server authority.

All packages are ESM-only. Server entry points require Node.js 20.9 or newer.

Maintainers should read [the internal invariants](./docs/INTERNAL_INVARIANTS.md)
before changing identifier, delivery, origin, or lifecycle behavior.
