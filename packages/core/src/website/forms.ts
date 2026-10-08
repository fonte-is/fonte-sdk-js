import { routePermitted } from "../collection-policy.js";
import type { SiteSettingsV1, WebsitePlacementV1 } from "./contract.js";
import { createFormView } from "./form-view.js";
import type { SubmitWebsiteForm } from "./form-submit.js";

const documents = new WeakMap<
  Document,
  { shown: boolean; dismissed: boolean }
>();
type Surface = {
  parent: Element;
  placement: WebsitePlacementV1;
  state: "loading" | "mounted" | "failed";
  view: ReturnType<typeof createFormView> | null;
};

export function createWebsiteForms(options: {
  submit: SubmitWebsiteForm;
  stylesheetUrl: string;
}): {
  apply(settings: SiteSettingsV1 | null): void;
  navigate(): void;
  destroy(): void;
  counts(): { mounted: number; unavailable: number };
} {
  if (typeof document === "undefined" || typeof window === "undefined")
    return {
      apply() {},
      navigate() {},
      destroy() {},
      counts: () => ({ mounted: 0, unavailable: 0 }),
    };
  let active = true;
  let settings: SiteSettingsV1 | null = null;
  let observer: MutationObserver | null = null;
  let inlineKeys = new Set<string>();
  const markers = new Map<string, Set<Element>>();
  const surfaces = new Map<string, Surface>();
  const overlayState = documents.get(document) ?? {
    shown: false,
    dismissed: false,
  };
  documents.set(document, overlayState);
  let validStylesheet = false;
  try {
    const url = new URL(options.stylesheetUrl);
    validStylesheet =
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash;
  } catch {
    // Release dependencies are injected by the composer, never site settings.
  }
  const eligible = (placement: WebsitePlacementV1) =>
    routePermitted(window.location.pathname, {
      status: "unknown",
      version: "presentation",
      expiresAt: null,
      storage: "memory",
      routes: placement.paths,
    });
  const remove = (key: string) => {
    const surface = surfaces.get(key);
    surfaces.delete(key);
    surface?.view?.destroy();
  };
  const stopObserving = () => {
    observer?.disconnect();
    observer = null;
    markers.clear();
    inlineKeys.clear();
  };
  const addMarker = (element: Element) => {
    const key = element.getAttribute("data-fonte-placement");
    if (!key || !inlineKeys.has(key) || !element.isConnected) return;
    let group = markers.get(key);
    if (!group) markers.set(key, (group = new Set()));
    group.add(element);
  };
  const inspect = (root: Element | Document) => {
    if (root instanceof Element) addMarker(root);
    for (const marker of root.querySelectorAll("[data-fonte-placement]"))
      addMarker(marker);
  };
  const firstMarker = (key: string) => {
    const group = markers.get(key);
    let first: Element | null = null;
    if (group)
      for (const candidate of group) {
        if (
          !candidate.isConnected ||
          candidate.getAttribute("data-fonte-placement") !== key
        ) {
          group.delete(candidate);
          continue;
        }
        if (
          !first ||
          candidate.compareDocumentPosition(first) &
            Node.DOCUMENT_POSITION_FOLLOWING
        )
          first = candidate;
      }
    return first;
  };
  const mount = (placement: WebsitePlacementV1, parent: Element) => {
    if (!validStylesheet) return;
    const surface: Surface = {
      placement,
      parent,
      state: "loading",
      view: null,
    };
    surfaces.set(placement.key, surface);
    surface.view = createFormView({
      placement,
      parent,
      stylesheetUrl: options.stylesheetUrl,
      submit: options.submit,
      ready() {
        if (!active || surfaces.get(placement.key) !== surface) return;
        surface.state = "mounted";
        if (placement.presentation !== "inline") overlayState.shown = true;
      },
      failed() {
        if (active && surfaces.get(placement.key) === surface)
          surface.state = "failed";
      },
      dismissed() {
        overlayState.dismissed = true;
        surfaces.delete(placement.key);
      },
    });
  };
  const reconcile = () => {
    if (!active || document.readyState === "loading" || !document.body) return;
    const placements = settings?.enabled
      ? settings.placements.filter(eligible)
      : [];
    const inline = placements.filter((p) => p.presentation === "inline");
    const overlay = placements.find((p) => p.presentation !== "inline");
    const nextKeys = new Set(inline.map((p) => p.key));
    const overlaySurface = overlay ? surfaces.get(overlay.key) : undefined;
    const watchOverlay = Boolean(
      overlay &&
      !overlayState.dismissed &&
      (overlaySurface
        ? overlaySurface.state !== "failed"
        : !overlayState.shown),
    );
    if (!nextKeys.size && !watchOverlay) stopObserving();
    else if (
      !observer ||
      [...nextKeys].some((key) => !inlineKeys.has(key)) ||
      nextKeys.size !== inlineKeys.size
    ) {
      stopObserving();
      inlineKeys = nextKeys;
      if (inlineKeys.size) inspect(document);
      observer = new MutationObserver((records) => {
        if (!active) return;
        for (const record of records)
          for (const node of record.addedNodes)
            if (inlineKeys.size && node instanceof Element) inspect(node);
        // At most the configured placements are reconciled. No document query
        // occurs here; only added subtrees and retained exact markers are read.
        reconcile();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    for (const [key, surface] of surfaces) {
      const next = placements.find(
        (p) =>
          p.key === key && p.presentation === surface.placement.presentation,
      );
      const parent =
        next?.presentation === "inline" ? firstMarker(key) : document.body;
      if (
        !next ||
        parent !== surface.parent ||
        !surface.parent.isConnected ||
        (next.presentation !== "inline" && overlay?.key !== key)
      )
        remove(key);
      else if (
        surface.state !== "failed" &&
        surface.view &&
        !surface.view.host.isConnected
      ) {
        surface.view.destroy();
        surface.view = null;
        surface.state = "failed";
        if (surface.placement.presentation !== "inline") {
          overlayState.dismissed = true;
          surfaces.delete(key);
        }
      } else {
        surface.placement = next;
        surface.view?.update(next.form);
      }
    }
    for (const placement of inline) {
      const parent = firstMarker(placement.key);
      if (parent && !surfaces.has(placement.key)) mount(placement, parent);
    }
    if (
      overlay &&
      !overlayState.shown &&
      !overlayState.dismissed &&
      ![...surfaces.values()].some((s) => s.placement.presentation !== "inline")
    )
      mount(overlay, document.body);
  };
  const ready = () => reconcile();
  document.addEventListener("DOMContentLoaded", ready, { once: true });
  return {
    apply(next) {
      if (!active) return;
      settings = next;
      // A new applied generation may retry a failed release stylesheet.
      for (const [key, surface] of surfaces)
        if (surface.state === "failed") remove(key);
      reconcile();
    },
    navigate: reconcile,
    counts() {
      if (!active || !settings?.enabled) return { mounted: 0, unavailable: 0 };
      let unavailable = 0;
      for (const placement of settings.placements.filter(eligible)) {
        if (placement.presentation === "inline") {
          firstMarker(placement.key);
          // Suppressed duplicate markers are aggregate unavailable surfaces;
          // this never logs keys, values or other visitor information.
          unavailable += Math.max(
            0,
            (markers.get(placement.key)?.size ?? 0) - 1,
          );
          if (surfaces.get(placement.key)?.state !== "mounted") unavailable++;
        }
      }
      const overlay = settings.placements.find(
        (p) => p.presentation !== "inline" && eligible(p),
      );
      if (
        overlay &&
        !overlayState.dismissed &&
        !overlayState.shown &&
        surfaces.get(overlay.key)?.state !== "mounted"
      )
        unavailable++;
      return {
        mounted: [...surfaces.values()].filter((s) => s.state === "mounted")
          .length,
        unavailable,
      };
    },
    destroy() {
      if (!active) return;
      active = false;
      document.removeEventListener("DOMContentLoaded", ready);
      stopObserving();
      for (const key of surfaces.keys()) remove(key);
      settings = null;
    },
  };
}
