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
  const capture = useMemo(() => createCapture({ storage: "my-app" }), []);
  return <FonteProvider capture={capture}>...</FonteProvider>;
}
```

The provider calls the supplied Core capture on initial mount and client-side
route changes. Use Core's `onDelivery` option when automatic delivery outcomes
must be observed. The provider does not redefine Core collection behavior.
