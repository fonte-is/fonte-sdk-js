# `@fonte-is/react`

React lifecycle bindings over `@fonte-is/core`.

```sh
npm install @fonte-is/core @fonte-is/react react
```

```tsx
import { createCapture } from "@fonte-is/core";
import { FonteProvider } from "@fonte-is/react";
import { useMemo } from "react";

export function App() {
  const capture = useMemo(
    () =>
      createCapture({
        storage: "my-app",
        collectionPolicy: () => readApprovedSitePolicy(),
      }),
    [],
  );
  return <FonteProvider capture={capture}>...</FonteProvider>;
}
```

The provider calls the supplied Core capture on initial mount and client-side
route changes. Use Core's `onDelivery` option when automatic delivery outcomes
must be observed. The provider does not redefine Core collection behavior.

Effect replay and rerender preserve the current occurrence. Actual push/pop navigation creates a new occurrence, including a same-URL revisit. A same-URL replace does not. Nested Next history wrappers cannot revive a released listener.
