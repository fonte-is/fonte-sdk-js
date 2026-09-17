"use client";

import type { ReactNode } from "react";
import { createCapture } from "@fonte-is/core";
import { FonteProvider } from "@fonte-is/nextjs";

const capture = createCapture({
  storage: "packed-browser",
  collectionPolicy: () => ({
    status: "granted",
    version: "synthetic-consumer-v1",
    expiresAt: Date.now() + 60000,
    storage: "memory",
    routes: ["/", "/second"],
  }),
  capturePolicy: { mode: "all" },
});

export function FonteRuntime({ children }: { children: ReactNode }) {
  return (
    <FonteProvider capture={capture}>
      <output id="capture-result">active</output>
      {children}
    </FonteProvider>
  );
}
