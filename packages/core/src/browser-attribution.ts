import {
  adStorageQueryKeys,
  measurementQueryKeys,
  paidMediums,
} from "./collect-contract.js";
import { compactScope } from "./browser-scope.js";
import type { Scope } from "./types.js";

export type AttributionContext = {
  first_touch?: Scope;
  last_touch?: Scope;
  last_paid_touch?: Scope;
};

type StoredAttribution = {
  version: 1;
  first_touch: Scope;
  last_touch: Scope;
  last_paid_touch?: Scope;
  updated_at: number;
};

const externalReferrer = (referrer: string, currentUrl: string): boolean => {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin !== new URL(currentUrl).origin;
  } catch {
    return false;
  }
};

const isPaidScope = (scope: Scope): boolean =>
  Boolean(
    scope.gclid ||
    scope.gbraid ||
    scope.wbraid ||
    scope.fbclid ||
    scope.ttclid ||
    paidMediums.has(scope.utm_medium?.toLowerCase() ?? ""),
  );

export interface AttributionStore {
  read(): AttributionContext | null;
  write(scope: Scope, stored: AttributionContext | null): void;
}

export function createAttributionStore(
  storageKey: string,
  maxAgeDays: number,
): AttributionStore {
  const read = (): AttributionContext | null => {
    if (typeof window === "undefined") return null;
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(storageKey) ?? "null",
      ) as StoredAttribution | null;
      if (
        !stored ||
        stored.version !== 1 ||
        !Number.isFinite(stored.updated_at) ||
        Date.now() - stored.updated_at > maxAgeDays * 86_400_000
      ) {
        return null;
      }
      const firstTouch = compactScope(stored.first_touch ?? {});
      const lastTouch = compactScope(stored.last_touch ?? {});
      const lastPaidTouch = compactScope(stored.last_paid_touch ?? {});
      if (!firstTouch || !lastTouch) return null;
      return {
        first_touch: firstTouch,
        last_touch: lastTouch,
        ...(lastPaidTouch ? { last_paid_touch: lastPaidTouch } : {}),
      };
    } catch {
      return null;
    }
  };

  const write = (scope: Scope, stored: AttributionContext | null): void => {
    if (typeof window === "undefined") return;
    const value: StoredAttribution = {
      version: 1,
      first_touch: stored?.first_touch ?? scope,
      last_touch: scope,
      ...(isPaidScope(scope)
        ? { last_paid_touch: scope }
        : stored?.last_paid_touch
          ? { last_paid_touch: stored.last_paid_touch }
          : {}),
      updated_at: Date.now(),
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Attribution storage is best effort; the current request can still proceed.
    }
  };

  return { read, write };
}

interface SourceTouchPolicy {
  mode: "source_touch" | "all";
  captureDirectLanding?: boolean;
}

export function shouldCaptureSourceTouch(
  scope: Scope,
  stored: AttributionContext | null,
  policy: SourceTouchPolicy,
): boolean {
  if (policy.mode === "all") return true;
  if (
    scope.fonte ||
    measurementQueryKeys.some((key) => scope[key]) ||
    adStorageQueryKeys.some((key) => scope[key]) ||
    scope.fbc ||
    scope.fbp ||
    externalReferrer(scope.referrer ?? "", scope.current_url)
  ) {
    return true;
  }
  return policy.captureDirectLanding !== false && !stored?.first_touch;
}
