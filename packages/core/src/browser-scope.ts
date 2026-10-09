import { createClientAttemptId } from "./ids.js";
import { measurementQueryKeys, clean } from "./collect-contract.js";
import {
  minimizeScope,
  minimizeSourceEvidence,
  routePermitted,
  type CollectionPolicy,
} from "./collection-policy.js";
import type { Scope } from "./types.js";
import type { SourceEvidence } from "./source-evidence.js";
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
  const read = (
    policy: CollectionPolicy,
    referrer?: string,
  ): { scope: Scope; sourceEvidence: SourceEvidence } | null => {
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
    for (const key of [...measurementQueryKeys, "fonte", "fonte_click"]) {
      const value = url.searchParams.get(key);
      if (value) scope[key] = value;
    }
    const sourceEvidence: {
      query: { name: string; value: string }[];
      cookies: { name: string; value: string }[];
    } = { query: [], cookies: [] };
    if (policy.clickIds)
      for (const name of policy.sourceFields!.query) {
        const value = url.searchParams.get(name);
        if (value && /^[a-zA-Z0-9_.~-]{1,500}$/.test(value))
          sourceEvidence.query.push({ name, value });
      }
    if (policy.adCookies) {
      try {
        for (const part of document.cookie.split(";")) {
          const [name, ...encoded] = part.trim().split("=");
          if (!policy.sourceFields!.cookies.includes(name)) continue;
          const value = decodeURIComponent(encoded.join("="));
          if (
            /^[a-zA-Z0-9_.~-]{1,500}$/.test(value) &&
            !sourceEvidence.cookies.some((entry) => entry.name === name)
          )
            sourceEvidence.cookies.push({ name, value });
        }
      } catch {
        /* cookie unavailable */
      }
    }
    const minimized = minimizeScope(scope, policy);
    const evidence = minimizeSourceEvidence(sourceEvidence, policy);
    return minimized && evidence
      ? { scope: minimized, sourceEvidence: evidence }
      : null;
  };
  const reset = (explicitErasure = false) => {
    continuity = null;
    const eraseOwnedStorage = usedPersistentStorage || explicitErasure;
    usedPersistentStorage = false;
    if (typeof window === "undefined" || !eraseOwnedStorage) return;
    try {
      window.localStorage.removeItem(config.journeyStorageKey);
      window.localStorage.removeItem(config.deviceStorageKey);
    } catch {
      /* denied storage */
    }
  };
  return { read, reset };
}
