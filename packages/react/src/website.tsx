"use client";

import { useEffect } from "react";

export interface FonteProps {
  site: string;
  /** Explicit CMP/application handoff; the application owns its consent record. */
  consent?: "external";
}
const scriptUrl = "https://cdn.fonte.is/v1.js";
const loaderKey = Symbol.for("fonte.website.loader.v1");
type Loader = {
  site: string;
  consent: "external" | undefined;
  script: HTMLScriptElement;
  references: number;
};
const diagnostic = (code: string) => {
  try {
    console.warn(`[fonte.website] ${code}`);
  } catch {}
};

/**
 * Loads the same permanent script; it owns no capture, policy or route observer.
 * A legacy FonteProvider capture on the same site must be removed during migration:
 * independent legacy collectors are not deduplicated by the website installation.
 */
export function Fonte({ site, consent }: FonteProps): null {
  useEffect(() => {
    if (!/^site_[a-zA-Z0-9_-]{16,80}$/.test(site)) {
      diagnostic("invalid_site");
      return;
    }
    const globals = window as unknown as Record<symbol, unknown>;
    let loader = globals[loaderKey] as Loader | undefined;
    if (loader) {
      if (loader.site !== site) {
        diagnostic("site_conflict");
        return;
      }
      if (loader.consent !== consent) {
        diagnostic("consent_mode_conflict");
        return;
      }
    } else {
      // A static tag is an independent loading reference to the same runtime.
      const existing = [...document.scripts].find(
        (script) =>
          script.src === scriptUrl &&
          script.getAttribute("data-fonte-site") === site,
      );
      if (
        existing &&
        (existing.getAttribute("data-fonte-consent") === "external") !==
          (consent === "external")
      ) {
        diagnostic("consent_mode_conflict");
        return;
      }
      const script = existing ?? document.createElement("script");
      loader = { site, consent, script, references: 0 };
      globals[loaderKey] = loader;
      if (!existing) {
        script.async = true;
        script.src = scriptUrl;
        script.setAttribute("data-fonte-site", site);
        if (consent === "external")
          script.setAttribute("data-fonte-consent", "external");
        (document.head ?? document.documentElement).append(script);
      }
    }
    const owned = loader;
    owned.references += 1;
    return () => {
      owned.references = Math.max(0, owned.references - 1);
    };
    // The permanent installation survives client navigation and Strict Mode cleanup.
  }, [site, consent]);
  return null;
}
