"use client";

import type { ReactNode } from "react";
import { createCapture } from "@fonte-is/core";
import { FonteProvider } from "@fonte-is/nextjs";

const capture = createCapture({
  storage: "packed-browser",
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
