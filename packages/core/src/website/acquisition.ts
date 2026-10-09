import { createCaptureEngine } from "../browser.js";
import type { BrowserObservationTransport } from "../browser-delivery.js";
import type { CapturePageResult } from "../browser-types.js";
import type { BrowserLandingEvidence } from "../collect-types.js";
import { permitted, type CollectionPolicy } from "../collection-policy.js";
import { WebsiteConfigurationError } from "./contract.js";
import { validSiteId } from "./settings.js";

export type WebsiteObservationTransport = BrowserObservationTransport;
export type AcceptedWebsitePage = Readonly<{
  siteId: string;
  eventId: string;
  recordId: string;
}>;

export function createWebsiteAcquisition(options: {
  siteId: string;
  transport: WebsiteObservationTransport;
}): {
  setPolicy(policy: CollectionPolicy | null): void;
  page(options?: { navigation?: boolean }): Promise<CapturePageResult>;
  retry(): Promise<CapturePageResult>;
  latestPageEventId(): string | null;
  latestPageReceipt(): AcceptedWebsitePage | null;
  destroy(): void;
} {
  if (!validSiteId(options.siteId))
    throw new WebsiteConfigurationError("siteId");
  if (typeof options.transport !== "function")
    throw new WebsiteConfigurationError("transport");
  let active = true;
  let current: CollectionPolicy | null = null;
  let policyKey: string | null = null;
  let latestPageEventId: string | null = null;
  let latestPageReceipt: AcceptedWebsitePage | null = null;
  let currentPageEventId: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const engine = createCaptureEngine(
    {
      storage: `website:${options.siteId}`,
      collectionPolicy: () => (active ? current : null),
      onObservation: (body) => {
        if (body.eventType === "page_view") {
          currentPageEventId = body.eventId;
          latestPageEventId = null;
          latestPageReceipt = null;
        }
      },
      onDelivery: (delivery) => {
        if (
          active &&
          permitted(current) &&
          delivery.status === "failed" &&
          ["network_error", "http_error", "receipt_unavailable"].includes(
            delivery.reason ?? "",
          ) &&
          retryTimer === undefined
        )
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (active && permitted(current))
              void engine.retry().catch(() => {});
          }, 1000);
        if (
          active &&
          current &&
          delivery.eventId === currentPageEventId &&
          delivery.eventType === "page_view" &&
          delivery.status === "delivered" &&
          delivery.receipt?.eventId === delivery.eventId
        ) {
          latestPageEventId = delivery.eventId;
          latestPageReceipt = delivery.receipt.recordId
            ? Object.freeze({
                siteId: options.siteId,
                eventId: delivery.eventId,
                recordId: delivery.receipt.recordId,
              })
            : null;
        }
      },
    },
    options.transport,
  );
  const interactions = ["pointerdown", "keydown", "touchstart"] as const;
  const interaction = (event: Event) => {
    if (
      !active ||
      !permitted(current) ||
      !event.isTrusted ||
      document.visibilityState !== "visible"
    )
      return;
    const evidence: BrowserLandingEvidence = {
      version: "interaction.v1",
      visibility: "visible",
      interaction: event.type as BrowserLandingEvidence["interaction"],
    };
    void engine.landing(evidence).catch(() => {});
  };
  if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
  )
    for (const type of interactions)
      document.addEventListener(type, interaction, {
        capture: true,
        passive: true,
      });
  const checkPolicy = () => {
    if (!permitted(current)) {
      current = null;
      policyKey = null;
      engine.resetContext();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
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
          if (next!.sourceFields) {
            Object.freeze(next!.sourceFields.query);
            Object.freeze(next!.sourceFields.cookies);
            Object.freeze(next!.sourceFields);
          }
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
      if (changed) {
        latestPageEventId = null;
        latestPageReceipt = null;
        currentPageEventId = null;
        engine.resetContext();
      }
    },
    page(pageOptions) {
      checkPolicy();
      if (pageOptions?.navigation) {
        latestPageEventId = null;
        latestPageReceipt = null;
        currentPageEventId = null;
      }
      return engine.page(pageOptions);
    },
    retry() {
      checkPolicy();
      return engine.retry();
    },
    latestPageEventId() {
      return active && permitted(current) ? latestPageEventId : null;
    },
    latestPageReceipt() {
      return active && permitted(current) ? latestPageReceipt : null;
    },
    destroy() {
      if (!active) return;
      active = false;
      if (
        typeof document !== "undefined" &&
        typeof document.removeEventListener === "function"
      )
        for (const type of interactions)
          document.removeEventListener(type, interaction, true);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      current = null;
      policyKey = null;
      latestPageEventId = null;
      latestPageReceipt = null;
      currentPageEventId = null;
      engine.resetContext();
    },
  };
}
