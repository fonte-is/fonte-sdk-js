import { createClientAttemptId } from "./ids.js";
import {
  adStorageQueryKeys,
  measurementQueryKeys,
  clean,
} from "./collect-contract.js";
import {
  minimizeScope,
  routePermitted,
  type CollectionPolicy,
} from "./collection-policy.js";
import type { Scope } from "./types.js";
export const compactScope = (value: unknown): Scope | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => typeof v === "string")
      .map(([k, v]) => [k, clean(v)]),
  );
};
export function createScopeReader(config: {
  deviceStorageKey: string;
  journeyStorageKey: string;
  maxAgeDays: number | null;
}) {
  let usedPersistentStorage = false;
  let continuity: { id: string; expiresAt: number } | null = null;
  const read = (policy: CollectionPolicy, referrer?: string): Scope | null => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return null;
    const url = new URL(window.location.href);
    if (!routePermitted(url.pathname, policy)) return null;
    if (!continuity && policy.storage === "persistent") {
      usedPersistentStorage = true;
      try {
        const saved = JSON.parse(
          window.localStorage.getItem(config.journeyStorageKey) ?? "null",
        );
        if (
          saved &&
          /^[0-9a-f-]{36}$/i.test(saved.id) &&
          saved.expiresAt > Date.now()
        )
          continuity = saved;
      } catch {
        /* use memory */
      }
    }
    if (!continuity || continuity.expiresAt <= Date.now()) {
      continuity = {
        id: createClientAttemptId(),
        expiresAt: Math.min(
          policy.expiresAt ?? Number.MAX_SAFE_INTEGER,
          config.maxAgeDays === null
            ? Number.MAX_SAFE_INTEGER
            : Date.now() + config.maxAgeDays * 86400000,
        ),
      };
      if (policy.storage === "persistent")
        try {
          window.localStorage.setItem(
            config.journeyStorageKey,
            JSON.stringify(continuity),
          );
        } catch {
          /* use memory */
        }
    }
    const scope: Scope = {
      current_url: url.href,
      referrer: referrer ?? document.referrer,
      fonte_journey_id: continuity.id,
    };
    for (const key of [
      ...measurementQueryKeys,
      ...adStorageQueryKeys,
      "fonte",
    ]) {
      const value = url.searchParams.get(key);
      if (value) scope[key] = value;
    }
    if (policy.adCookies) {
      try {
        for (const part of document.cookie.split(";")) {
          const [key, ...value] = part.trim().split("=");
          if (key === "_fbc" || key === "_fbp")
            scope[key.slice(1)] = decodeURIComponent(value.join("="));
        }
      } catch {
        /* cookie unavailable */
      }
    }
    return minimizeScope(scope, policy);
  };
  const reset = (explicitErasure = false) => {
    continuity = null;
    if (
      typeof window === "undefined" ||
      (!usedPersistentStorage && !explicitErasure)
    )
      return;
    try {
      window.localStorage.removeItem(config.journeyStorageKey);
      window.localStorage.removeItem(config.deviceStorageKey);
    } catch {
      /* denied storage */
    }
  };
  return { read, reset };
}
