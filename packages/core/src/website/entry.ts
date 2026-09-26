import { createWebsiteAcquisition } from "./acquisition.js";
import type { WebsiteRuntime } from "./contract.js";
import {
  WEBSITE_RELEASE,
  websiteEndpoints,
  websiteStylesheetUrl,
} from "./endpoints.js";
import { createWebsiteForms } from "./forms.js";
import { createWebsiteHttp } from "./http.js";
import { startWebsiteRuntime } from "./runtime.js";
import { validSiteId } from "./settings.js";

const singleton = Symbol.for("fonte.website.v1");
const entrySlot = Symbol.for("fonte.website.entry.v1");
const consentSlot = Symbol.for("fonte.website.consent.v1");
type Entry = { siteId: string; runtime: WebsiteRuntime; external: boolean };
const diagnostic = (code: string) => {
  try {
    console.warn(`[fonte.website] ${code}`);
  } catch {}
};
function initialConsent(siteId: string, record: unknown): "granted" | "denied" {
  try {
    if (!record || typeof record !== "object" || Array.isArray(record))
      return "denied";
    const value = record as Record<string, unknown>;
    if (
      Reflect.ownKeys(value).length !== 2 ||
      !Object.hasOwn(value, "siteId") ||
      !Object.hasOwn(value, "status") ||
      value.siteId !== siteId
    )
      return "denied";
    return value.status === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** One direct composer; duplicate execution never creates another feature owner. */
export function installWebsite(
  siteId: string,
  external = false,
): WebsiteRuntime | null {
  if (typeof window === "undefined" || typeof document === "undefined")
    return null;
  if (!validSiteId(siteId)) {
    diagnostic("invalid_site");
    return null;
  }
  const globals = window as unknown as Record<symbol, unknown> & {
    fonte?: unknown;
  };
  let consent: "granted" | "denied" = "denied";
  if (external) {
    try {
      consent = initialConsent(siteId, globals[consentSlot]);
    } catch {}
  }
  const urls = websiteEndpoints(siteId);
  const existing = globals[singleton];
  if (existing !== undefined) {
    const handle = startWebsiteRuntime({
      siteId,
      runtimeVersion: WEBSITE_RELEASE,
      settingsUrl: urls.settings,
    });
    const entry = globals[entrySlot] as Entry | undefined;
    if (entry?.runtime === handle && entry.external !== external)
      diagnostic("consent_mode_conflict");
    if (handle.getStatus().state === "conflict") diagnostic("site_conflict");
    return handle;
  }
  const http = createWebsiteHttp({ siteId });
  const acquisition = createWebsiteAcquisition({
    siteId,
    transport: http.transport,
  });
  const forms = createWebsiteForms({
    submit: http.submit,
    stylesheetUrl: websiteStylesheetUrl,
  });
  const runtime = startWebsiteRuntime({
    siteId,
    runtimeVersion: WEBSITE_RELEASE,
    settingsUrl: urls.settings,
    onSettings: (settings) => forms.apply(settings),
    onCollectionPolicy: (policy) => acquisition.setPolicy(policy),
    onNavigation: (occurrence) => {
      forms.navigate();
      void acquisition
        .page({ navigation: occurrence.navigation })
        .catch(() => {});
    },
    getFormCounts: () => forms.counts(),
  });
  // Startup is deferred by the foundation; this handoff precedes validation.
  if (external) runtime.setConsent(consent);
  const entry: Entry = { siteId, runtime, external };
  globals[entrySlot] = entry;
  const destroy = runtime.destroy.bind(runtime);
  runtime.destroy = () => {
    destroy();
    acquisition.destroy();
    forms.destroy();
    http.destroy();
    if (globals[entrySlot] === entry) delete globals[entrySlot];
    if (globals.fonte === runtime) delete globals.fonte;
  };
  if (globals.fonte === undefined) globals.fonte = runtime;
  else diagnostic("global_conflict");
  return runtime;
}

// Capture this element before any asynchronous work, including an async tag load.
if (typeof document !== "undefined") {
  const script = document.currentScript;
  if (script instanceof HTMLScriptElement) {
    try {
      installWebsite(
        script.getAttribute("data-fonte-site") ?? "",
        script.getAttribute("data-fonte-consent") === "external",
      );
    } catch {
      diagnostic("entry_unavailable");
    }
  }
}
