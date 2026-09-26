import { createCaptureEngine } from "../browser.js";
import type { BrowserObservationTransport } from "../browser-delivery.js";
import type { CapturePageResult } from "../browser-types.js";
import { permitted, type CollectionPolicy } from "../collection-policy.js";
import { WebsiteConfigurationError } from "./contract.js";
import { validSiteId } from "./settings.js";

export type WebsiteObservationTransport = BrowserObservationTransport;

export function createWebsiteAcquisition(options: {
  siteId: string;
  transport: WebsiteObservationTransport;
}): {
  setPolicy(policy: CollectionPolicy | null): void;
  page(options?: { navigation?: boolean }): Promise<CapturePageResult>;
  retry(): Promise<CapturePageResult>;
  destroy(): void;
} {
  if (!validSiteId(options.siteId))
    throw new WebsiteConfigurationError("siteId");
  if (typeof options.transport !== "function")
    throw new WebsiteConfigurationError("transport");
  let active = true;
  let current: CollectionPolicy | null = null;
  let policyKey: string | null = null;
  const engine = createCaptureEngine(
    {
      storage: `website:${options.siteId}`,
      collectionPolicy: () => (active ? current : null),
    },
    options.transport,
  );
  const checkPolicy = () => {
    if (!permitted(current)) {
      current = null;
      policyKey = null;
      engine.resetContext();
    }
  };
  return {
    setPolicy(policy) {
      if (!active) return;
      let next: CollectionPolicy | null = null;
      try {
        if (permitted(policy)) {
          next = JSON.parse(JSON.stringify(policy)) as CollectionPolicy;
          Object.freeze(next!.routes);
          if (next!.campaignValues && next!.campaignValues !== true) {
            for (const values of Object.values(next!.campaignValues))
              Object.freeze(values);
            Object.freeze(next!.campaignValues);
          }
          Object.freeze(next);
        }
      } catch {
        next = null;
      }
      const nextKey = next ? JSON.stringify(next) : null;
      const changed = policyKey !== nextKey;
      current = next;
      policyKey = nextKey;
      if (changed) engine.resetContext();
    },
    page(pageOptions) {
      checkPolicy();
      return engine.page(pageOptions);
    },
    retry() {
      checkPolicy();
      return engine.retry();
    },
    destroy() {
      if (!active) return;
      active = false;
      current = null;
      policyKey = null;
      engine.resetContext();
    },
  };
}
