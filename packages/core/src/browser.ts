"use client";
import { shouldCaptureSourceTouch } from "./browser-attribution.js";
import {
  createDeliveryClient,
  type BrowserObservationTransport,
} from "./browser-delivery.js";
import { createScopeReader } from "./browser-scope.js";
import { clean } from "./collect-contract.js";
import { permitted } from "./collection-policy.js";
import { createClientAttemptId } from "./ids.js";
import { normalizeInstallationVerification } from "./installation-verification.js";
import type {
  Capture,
  CaptureConfig,
  CaptureDeliveryReason,
  CaptureEventType,
} from "./browser-types.js";
import type { Scope } from "./types.js";
import type { CollectionPolicy } from "./collection-policy.js";
import type { CollectBody } from "./collect-types.js";
const eventTypes: CaptureEventType[] = ["page_view", "source_touch"];
export function createCapture(config: CaptureConfig): Capture {
  const engine = createCaptureEngine(config);
  return { page: engine.page, retry: engine.retry, reset: engine.reset };
}
/** Internal supplier shared by the unchanged legacy wrapper and website port. */
export function createCaptureEngine(
  config: CaptureConfig,
  transport?: BrowserObservationTransport,
): Capture & { resetContext(): void } {
  const storage = clean(config.storage, 120).replace(/:+$/g, "");
  if (!storage) throw Error("fonte_storage_key_required");
  const collectPath = config.collect ?? "/api/fonte/collect";
  if (
    !collectPath.startsWith("/") ||
    collectPath.startsWith("//") ||
    collectPath.includes("\\")
  )
    throw Error("fonte_collect_path_must_be_same_origin_app_path");
  const verification = config.verification
    ? normalizeInstallationVerification(config.verification)
    : null;
  if (config.verification && !verification)
    throw Error("fonte_invalid_installation_verification");
  const maxAgeDays = config.maxAgeDays ?? null;
  if (maxAgeDays !== null && (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0))
    throw Error("fonte_max_age_days_must_be_positive");
  if (
    config.capturePolicy?.mode &&
    !["source_touch", "all"].includes(config.capturePolicy.mode)
  )
    throw Error("fonte_invalid_capture_policy_mode");
  const policy = () => {
    try {
      return config.collectionPolicy?.() ?? null;
    } catch {
      return null;
    }
  };
  const scopeReader = createScopeReader({
    deviceStorageKey: `${storage}:fonte-device-id`,
    journeyStorageKey: `${storage}:fonte-journey-v2`,
    maxAgeDays,
  });
  const delivery = createDeliveryClient({
    collectPath,
    policy,
    onDelivery: config.onDelivery,
    transport,
  });
  let currentHref: string | undefined;
  let currentDocument: Document | undefined;
  const skipped = (reason: CaptureDeliveryReason) => ({
    deliveries: eventTypes.map((eventType) =>
      delivery.notify({ eventType, status: "skipped", reason }),
    ),
  });
  return {
    async page(options) {
      const approved = policy();
      if (!permitted(approved)) {
        delivery.reset();
        scopeReader.reset();
        currentHref = undefined;
        return skipped("collection_not_permitted");
      }
      if (typeof window === "undefined" || typeof document === "undefined")
        return skipped("browser_unavailable");
      const href = window.location.href;
      if (
        currentHref === href &&
        currentDocument === document &&
        !options?.navigation
      )
        return skipped("duplicate");
      const scope = scopeReader.read(
        approved,
        currentDocument === document ? currentHref : undefined,
      );
      if (!scope) return skipped("route_not_permitted");
      currentHref = href;
      currentDocument = document;
      const occurrenceId = createClientAttemptId();
      const occurredAt = new Date().toISOString();
      // Both views refer to one arrival. The source view also records no-referrer coverage.
      const selectedEvents = shouldCaptureSourceTouch(scope, null, {
        mode: config.capturePolicy?.mode ?? "source_touch",
        captureDirectLanding: config.capturePolicy?.captureDirectLanding,
      })
        ? eventTypes
        : (["page_view"] as const);
      const snapshots = observations(
        selectedEvents,
        scope,
        approved,
        verification,
        occurrenceId,
        occurredAt,
      );
      for (const body of snapshots)
        try {
          config.onObservation?.(JSON.parse(JSON.stringify(body)));
        } catch {
          /* optional observer */
        }
      return {
        deliveries: await Promise.all(
          snapshots.map((body) => delivery.submit(body, approved)),
        ),
      };
    },
    async retry() {
      return { deliveries: await delivery.retry() };
    },
    reset() {
      delivery.reset();
      scopeReader.reset(true);
      currentHref = undefined;
      currentDocument = undefined;
    },
    resetContext() {
      currentHref = undefined;
      currentDocument = undefined;
      scopeReader.reset();
      delivery.reset();
    },
  };
}
export type {
  Capture,
  CaptureConfig,
  CaptureDelivery,
  CaptureDeliveryReason,
  CaptureEventType,
  CapturePageResult,
  CollectionPolicy,
} from "./browser-types.js";
export type { Scope } from "./types.js";

function observations(
  events: readonly CaptureEventType[],
  scope: Scope,
  policy: CollectionPolicy,
  verification: CaptureConfig["verification"] | null,
  occurrenceId: string,
  occurredAt: string,
): CollectBody[] {
  return events.map((eventType) => ({
    schemaVersion: "fonte.acquisition.v1",
    classifierVersion: "source.v2",
    collectionVersion: policy.version,
    occurrenceId,
    occurredAt,
    eventId: createClientAttemptId(),
    eventType,
    journeyId: scope.fonte_journey_id,
    scope,
    ...(eventType === "source_touch" && verification ? { verification } : {}),
  }));
}
