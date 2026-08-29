"use client";

import {
  createAttributionStore,
  shouldCaptureSourceTouch,
} from "./browser-attribution.js";
import { createDeliveryClient } from "./browser-delivery.js";
import { createScopeReader } from "./browser-scope.js";
import type {
  Capture,
  CaptureConfig,
  CaptureDelivery,
  CaptureDeliveryReason,
  CapturePageResult,
} from "./browser-types.js";
import { clean } from "./collect-contract.js";
import { normalizeInstallationVerification } from "./installation-verification.js";
import { resolveBrowserCollectionPosture } from "./collection-posture.js";

const eventTypes = ["page_view", "source_touch"] as const;

const requireAppPath = (value: string): string => {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("fonte_collect_path_must_be_same_origin_app_path");
  }
  return value;
};

export function createCapture(config: CaptureConfig): Capture {
  const storagePrefix = clean(config.storage, 120).replace(/:+$/g, "");
  if (!storagePrefix) throw new Error("fonte_storage_key_required");

  const collectPath = requireAppPath(config.collect ?? "/api/fonte/collect");
  const verification = config.verification
    ? normalizeInstallationVerification(config.verification)
    : null;
  if (config.verification && !verification) {
    throw new Error("fonte_invalid_installation_verification");
  }
  const maxAgeDays = config.maxAgeDays ?? 90;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    throw new Error("fonte_max_age_days_must_be_positive");
  }
  const mode = config.capturePolicy?.mode ?? "source_touch";
  if (mode !== "source_touch" && mode !== "all") {
    throw new Error("fonte_invalid_capture_policy_mode");
  }
  const posture = resolveBrowserCollectionPosture(config.collectionPosture);

  const currentScope = createScopeReader({
    deviceStorageKey: `${storagePrefix}:fonte-device-id`,
    journeyStorageKey: `${storagePrefix}:fonte-journey-id`,
    persistentIdentityAllowed: posture?.persistentIdentityAllowed ?? false,
    adStorageAllowed: posture?.adStorageAllowed ?? false,
  });
  const attribution = posture?.persistentIdentityAllowed
    ? createAttributionStore(`${storagePrefix}:fonte-attribution`, maxAgeDays)
    : { read: () => null, write: () => undefined };
  const delivery = createDeliveryClient({
    collectPath,
    sentStoragePrefix: `${storagePrefix}:fonte-touch`,
    verification,
    collectionPostureObservation: posture?.observation ?? null,
    journeyIdentityScope: posture?.journeyIdentityScope ?? null,
    onDelivery: config.onDelivery,
  });

  const skipped = (reason: CaptureDeliveryReason): CapturePageResult => ({
    deliveries: eventTypes.map((eventType) =>
      delivery.notify({ eventType, status: "skipped", reason }),
    ),
  });

  const capturePage = async (
    retryPending: boolean,
  ): Promise<CapturePageResult> => {
    if (!posture) {
      const reason = config.collectionPosture
        ? "visitor_choice_unavailable"
        : "collection_posture_unavailable";
      return {
        deliveries: eventTypes.map((eventType) =>
          delivery.notify({ eventType, status: "unavailable", reason }),
        ),
      };
    }
    const scope = currentScope();
    if (!scope) return skipped("browser_unavailable");
    const stored = attribution.read();
    const deliveries: Array<Promise<CaptureDelivery>> = [
      delivery.send("page_view", scope, retryPending),
    ];
    if (
      shouldCaptureSourceTouch(scope, stored, {
        mode,
        captureDirectLanding: config.capturePolicy?.captureDirectLanding,
      })
    ) {
      attribution.write(scope, stored);
      deliveries.push(delivery.send("source_touch", scope, retryPending));
    } else {
      deliveries.push(
        Promise.resolve(
          delivery.notify({
            eventType: "source_touch",
            status: "skipped",
            reason: "not_source_touch",
          }),
        ),
      );
    }
    return { deliveries: await Promise.all(deliveries) };
  };

  return {
    page: () => capturePage(false),
    retry: () => capturePage(true),
  };
}

export type {
  Capture,
  CaptureConfig,
  CaptureDelivery,
  CaptureDeliveryReason,
  CaptureEventType,
  CapturePageResult,
} from "./browser-types.js";
export type { Scope } from "./types.js";
