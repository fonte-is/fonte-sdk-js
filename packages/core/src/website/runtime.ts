import { permitted, type CollectionPolicy } from "../collection-policy.js";
import {
  WebsiteConfigurationError,
  type SiteSettingsV1,
  type WebsiteRuntime,
  type WebsiteStatus,
} from "./contract.js";
import {
  observeWebsiteNavigation,
  type WebsiteOccurrence,
} from "./navigation.js";
import {
  MAX_SETTINGS_BYTES,
  parseSiteSettings,
  validSiteId,
} from "./settings.js";

interface WebsiteRuntimeOptions {
  siteId: string;
  runtimeVersion: string;
  settingsUrl: string;
  fetchImpl?: typeof fetch;
  onSettings?: (settings: SiteSettingsV1 | null) => void;
  onNavigation?: (occurrence: WebsiteOccurrence) => void;
  onCollectionPolicy?: (policy: CollectionPolicy | null) => void;
  getFormCounts?: () => { mounted: number; unavailable: number };
}
const singleton = Symbol.for("fonte.website.v1");
type Slot = { siteId: string; runtime: WebsiteRuntime };
const globals = () => window as unknown as Record<symbol, unknown>;
const invoke = <T>(callback: ((value: T) => void) | undefined, value: T) => {
  try {
    callback?.(value);
  } catch {
    /* Host diagnostics cannot change authority. */
  }
};
function inert(
  options: WebsiteRuntimeOptions,
  state: "conflict" | "unavailable",
): WebsiteRuntime {
  return {
    getStatus: () => ({
      siteId: typeof options?.siteId === "string" ? options.siteId : "",
      runtimeVersion:
        typeof options?.runtimeVersion === "string"
          ? options.runtimeVersion
          : "",
      settingsRevision: null,
      state,
      collection: "unavailable",
      forms: { mounted: 0, unavailable: 0 },
    }),
    setConsent() {},
    refresh: async () => {},
    destroy() {},
  };
}
function validateOptions(options: WebsiteRuntimeOptions): void {
  if (!options || !validSiteId(options.siteId))
    throw new WebsiteConfigurationError("siteId");
  if (
    typeof options.runtimeVersion !== "string" ||
    !/^[a-zA-Z0-9_.:+-]{1,120}$/.test(options.runtimeVersion)
  )
    throw new WebsiteConfigurationError("runtimeVersion");
  const url = new URL(options.settingsUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new WebsiteConfigurationError("settingsUrl");
  if (
    options.fetchImpl !== undefined &&
    typeof options.fetchImpl !== "function"
  )
    throw new WebsiteConfigurationError("fetchImpl");
  for (const key of [
    "onSettings",
    "onNavigation",
    "onCollectionPolicy",
    "getFormCounts",
  ] as const)
    if (options[key] !== undefined && typeof options[key] !== "function")
      throw new WebsiteConfigurationError(key);
}
async function boundedJson(
  response: Response,
  controller: AbortController,
): Promise<unknown> {
  if (controller.signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw new WebsiteConfigurationError("settings.aborted");
  }
  if (!response.body) throw new WebsiteConfigurationError("settings.body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  controller.signal.addEventListener("abort", cancel, { once: true });
  let total = 0;
  let json = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (controller.signal.aborted)
        throw new WebsiteConfigurationError("settings.aborted");
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_SETTINGS_BYTES) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw new WebsiteConfigurationError("settings.bytes");
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json) as unknown;
  } finally {
    controller.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function startWebsiteRuntime(
  options: WebsiteRuntimeOptions,
): WebsiteRuntime {
  if (typeof window === "undefined" || typeof document === "undefined")
    return inert(options, "unavailable");
  const existing = globals()[singleton];
  if (existing !== undefined) {
    const slot = existing as Partial<Slot> | null;
    if (
      slot &&
      slot.siteId === options?.siteId &&
      slot.runtime &&
      typeof slot.runtime.getStatus === "function"
    )
      return slot.runtime;
    return inert(options, "conflict");
  }
  try {
    validateOptions(options);
  } catch {
    return inert(options, "unavailable");
  }
  const { siteId, runtimeVersion, settingsUrl } = options;
  let fetchImpl: typeof fetch | undefined =
    options.fetchImpl ?? window.fetch.bind(window);
  let onSettings = options.onSettings;
  let onNavigation = options.onNavigation;
  let onCollectionPolicy = options.onCollectionPolicy;
  let getFormCounts = options.getFormCounts;
  let active = true;
  let state: WebsiteStatus["state"] = "loading";
  let collection: WebsiteStatus["collection"] = "unavailable";
  let generation: SiteSettingsV1 | null = null;
  let confirmed = false;
  let lastSuccess: number | null = null;
  let etag: string | null = null;
  let consent: CollectionPolicy["status"] = "unknown";
  let policyKey: string | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  let inFlight: Promise<void> | null = null;
  // This is only the current URL, never a buffered acquisition payload.
  let pendingOccurrence: WebsiteOccurrence | null = {
    href: window.location.href,
    navigation: false,
  };
  let releaseNavigation: (() => void) | undefined;
  let publishing = false;

  const effectivePolicy = (): CollectionPolicy | null => {
    if (!confirmed || !generation?.enabled) {
      collection = generation && !generation.enabled ? "off" : "unavailable";
      return null;
    }
    if (generation.collection.mode === "off") {
      collection = "off";
      return null;
    }
    if (consent === "denied") {
      collection = "denied";
      return null;
    }
    const approved = generation.collection.policy;
    if (
      !approved ||
      (approved.expiresAt !== null && approved.expiresAt <= Date.now())
    ) {
      collection = "unavailable";
      return null;
    }
    if (generation.collection.mode === "opt_in" && consent !== "granted") {
      collection = "unknown";
      return null;
    }
    const result: CollectionPolicy = { ...approved, status: "granted" };
    if (!permitted(result)) {
      collection = "unavailable";
      return null;
    }
    collection = "enabled";
    return Object.freeze(result);
  };
  const updatePolicy = (force = false) => {
    if (!active) return;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    const policy = effectivePolicy();
    const expiresAt = generation?.collection.policy?.expiresAt;
    if (
      confirmed &&
      expiresAt !== undefined &&
      expiresAt !== null &&
      expiresAt > Date.now()
    ) {
      expiryTimer = setTimeout(
        () => updatePolicy(),
        Math.min(expiresAt - Date.now(), 2_147_483_647),
      );
    }
    const nextKey = policy ? JSON.stringify(policy) : null;
    if (force || policyKey !== nextKey) {
      policyKey = nextKey;
      invoke(onCollectionPolicy, policy);
    }
  };
  const emitCurrent = () => {
    if (!active || publishing || !generation?.enabled || !pendingOccurrence)
      return;
    const occurrence = pendingOccurrence;
    pendingOccurrence = null;
    invoke(onNavigation, Object.freeze({ ...occurrence }));
  };
  const failRead = () => {
    if (!active) return;
    confirmed = false;
    state = "unavailable";
    updatePolicy(true);
    if (active && !generation) invoke(onSettings, null);
  };
  const refresh = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (inFlight) return inFlight;
    const controller = new AbortController();
    request = controller;
    // Microtask start allows reentrant callbacks to observe the same in-flight promise.
    const work = Promise.resolve().then(async () => {
      if (!active) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const read = async () => {
          const response = await fetchImpl!(settingsUrl, {
            method: "GET",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            headers: etag ? { "If-None-Match": etag } : {},
            signal: controller.signal,
          });
          let next: SiteSettingsV1;
          if (response.status === 304) {
            if (!generation)
              throw new WebsiteConfigurationError("settings.304");
            next = generation;
          } else {
            if (!response.ok)
              throw new WebsiteConfigurationError("settings.http");
            next = parseSiteSettings(
              await boundedJson(response, controller),
              siteId,
            );
          }
          if (!next.origins.includes(window.location.origin))
            throw new WebsiteConfigurationError("settings.origin");
          return {
            next,
            etag: response.headers.get("etag"),
            revalidated: response.status === 304,
          };
        };
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new WebsiteConfigurationError("settings.aborted")),
            { once: true },
          );
          timeout = setTimeout(() => controller.abort(), 3000);
        });
        const result = await Promise.race([read(), aborted]);
        if (!active || controller.signal.aborted) return;
        generation = result.next;
        etag = result.etag ?? (result.revalidated ? etag : null);
        confirmed = true;
        lastSuccess = Date.now();
        state = generation.enabled ? "ready" : "disabled";
        const validated = generation;
        publishing = true;
        try {
          updatePolicy(true);
          if (!active || generation !== validated) return;
          invoke(onSettings, validated.enabled ? validated : null);
        } finally {
          publishing = false;
        }
        if (!active || generation !== validated) return;
        if (validated.enabled) emitCurrent();
        else pendingOccurrence = null;
      } catch {
        failRead();
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        if (request === controller) request = null;
      }
    });
    inFlight = work.finally(() => {
      if (inFlight === completion) inFlight = null;
    });
    const completion = inFlight;
    return completion;
  };
  const refreshIfOld = () => {
    if (active && (lastSuccess === null || Date.now() - lastSuccess >= 60_000))
      void refresh();
  };
  const runtime: WebsiteRuntime = {
    getStatus() {
      let forms = { mounted: 0, unavailable: 0 };
      if (active)
        try {
          const counts = getFormCounts?.();
          if (
            counts &&
            Number.isSafeInteger(counts.mounted) &&
            counts.mounted >= 0 &&
            Number.isSafeInteger(counts.unavailable) &&
            counts.unavailable >= 0
          )
            forms = {
              mounted: counts.mounted,
              unavailable: counts.unavailable,
            };
        } catch {
          /* Aggregate diagnostics are optional. */
        }
      return {
        siteId,
        runtimeVersion,
        settingsRevision: generation?.revision ?? null,
        state,
        collection,
        forms,
      };
    },
    setConsent(status) {
      if (
        !active ||
        !["granted", "denied", "unknown"].includes(status) ||
        (consent === "denied" && status === "unknown") ||
        consent === status
      )
        return;
      consent = status;
      updatePolicy();
    },
    refresh,
    destroy() {
      if (!active) return;
      active = false;
      request?.abort();
      request = null;
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      expiryTimer = undefined;
      releaseNavigation?.();
      releaseNavigation = undefined;
      if (globals()[singleton] === slot) delete globals()[singleton];
      generation = null;
      pendingOccurrence = null;
      confirmed = false;
      state = "unavailable";
      collection = "unavailable";
      invoke(onCollectionPolicy, null);
      invoke(onSettings, null);
      onCollectionPolicy = undefined;
      onSettings = undefined;
      onNavigation = undefined;
      getFormCounts = undefined;
      fetchImpl = undefined;
      etag = null;
      lastSuccess = null;
      consent = "unknown";
      policyKey = null;
    },
  };
  const slot: Slot = { siteId, runtime };
  globals()[singleton] = slot;
  releaseNavigation = observeWebsiteNavigation((occurrence) => {
    if (!active) return;
    pendingOccurrence = occurrence;
    updatePolicy();
    if (!active) return;
    emitCurrent();
    refreshIfOld();
  }, refreshIfOld);
  void refresh();
  return runtime;
}
