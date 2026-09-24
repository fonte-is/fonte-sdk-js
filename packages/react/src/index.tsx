"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { Capture } from "@fonte-is/core";

export interface FonteProviderProps {
  capture: Capture;
  children?: ReactNode;
}

type RuntimeLease = {
  capture: Capture;
  references: number;
  captureCurrentPage(navigation?: boolean): void;
};

type RouteRuntime = {
  pushState: History["pushState"];
  replaceState: History["replaceState"];
  originalPushState: History["pushState"];
  originalReplaceState: History["replaceState"];
  scheduleCapture(): void;
  captureHashChange(): void;
};

const CaptureContext = createContext<Capture | null>(null);
const leases = new WeakMap<Capture, RuntimeLease>();
const activeLeases = new Set<RuntimeLease>();
let routeRuntime: RouteRuntime | null = null;

const captureAllActivePages = (): void => {
  for (const lease of activeLeases) lease.captureCurrentPage(true);
};

const ensureRouteRuntime = (): void => {
  if (routeRuntime || typeof window === "undefined") return;
  let observedHref = window.location.href;
  const scheduleCapture = () => {
    observedHref = window.location.href;
    captureAllActivePages();
  };
  // One traversal can dispatch both popstate and hashchange. Popstate owns
  // the occurrence; a hash-only change is observed if no earlier event did so.
  const captureHashChange = () => {
    if (window.location.href !== observedHref) scheduleCapture();
  };
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  const pushState = function pushState(
    this: History,
    ...args: Parameters<History["pushState"]>
  ) {
    const result = originalPushState.apply(this, args);
    if (routeRuntime?.pushState === pushState) scheduleCapture();
    return result;
  };
  const replaceState = function replaceState(
    this: History,
    ...args: Parameters<History["replaceState"]>
  ) {
    const before = window.location.href;
    const result = originalReplaceState.apply(this, args);
    if (
      routeRuntime?.replaceState === replaceState &&
      window.location.href !== before
    )
      scheduleCapture();
    return result;
  };
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  window.addEventListener("popstate", scheduleCapture);
  window.addEventListener("hashchange", captureHashChange);
  routeRuntime = {
    pushState,
    replaceState,
    originalPushState,
    originalReplaceState,
    scheduleCapture,
    captureHashChange,
  };
};

const releaseRouteRuntime = (): void => {
  if (!routeRuntime || activeLeases.size > 0 || typeof window === "undefined")
    return;
  if (window.history.pushState === routeRuntime.pushState) {
    window.history.pushState = routeRuntime.originalPushState;
  }
  if (window.history.replaceState === routeRuntime.replaceState) {
    window.history.replaceState = routeRuntime.originalReplaceState;
  }
  window.removeEventListener("popstate", routeRuntime.scheduleCapture);
  window.removeEventListener("hashchange", routeRuntime.captureHashChange);
  routeRuntime = null;
};

const acquire = (capture: Capture): (() => void) => {
  const current = leases.get(capture);
  if (current) {
    current.references += 1;
    return () => release(capture, current);
  }
  const lease: RuntimeLease = {
    capture,
    references: 1,
    captureCurrentPage(navigation = false) {
      if (typeof window === "undefined") return;
      void capture.page({ navigation }).catch(() => {});
    },
  };
  leases.set(capture, lease);
  activeLeases.add(lease);
  ensureRouteRuntime();
  lease.captureCurrentPage();
  return () => release(capture, lease);
};

const release = (capture: Capture, lease: RuntimeLease): void => {
  if (leases.get(capture) !== lease) return;
  lease.references -= 1;
  if (lease.references > 0) return;
  leases.delete(capture);
  activeLeases.delete(lease);
  releaseRouteRuntime();
};

export function FonteProvider({
  capture,
  children,
}: FonteProviderProps): ReactNode {
  useEffect(() => acquire(capture), [capture]);
  return (
    <CaptureContext.Provider value={capture}>
      {children}
    </CaptureContext.Provider>
  );
}

export function useFonte(): Capture {
  const capture = useContext(CaptureContext);
  if (!capture) throw new Error("fonte_provider_missing");
  return capture;
}

export type { Capture } from "@fonte-is/core";
