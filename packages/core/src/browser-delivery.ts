import type { InstallationVerificationMetadata } from "./installation-verification.js";
import { createClientAttemptId } from "./ids.js";
import {
  BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION,
  type JourneyIdentityScope,
} from "./collect-types.js";
import type { CollectionPostureObservation } from "./collection-posture.js";
import {
  parsePendingAttempt,
  pendingAttemptKey,
  type PendingAttempt,
} from "./browser-pending-attempt.js";
import type { CaptureDelivery, CaptureEventType } from "./browser-types.js";
import type { Scope } from "./types.js";

const pendingAttempts = new Map<string, PendingAttempt>();
const completed = new Set<string>();

interface DeliveryClientConfig {
  collectPath: string;
  sentStoragePrefix: string;
  verification: InstallationVerificationMetadata | null;
  collectionPostureObservation: CollectionPostureObservation | null;
  journeyIdentityScope: JourneyIdentityScope | null;
  onDelivery?: (delivery: CaptureDelivery) => void;
}

export interface DeliveryClient {
  notify(delivery: CaptureDelivery): CaptureDelivery;
  send(
    eventType: CaptureEventType,
    scope: Scope,
    retryPending: boolean,
  ): Promise<CaptureDelivery>;
}

type Notify = (delivery: CaptureDelivery) => CaptureDelivery;

const markCompleted = (key: string, eventId: string): void => {
  pendingAttempts.delete(key);
  completed.add(key);
  try {
    window.sessionStorage.setItem(key, `sent:${eventId}`);
  } catch {
    // completed remains authoritative for this page life.
  }
};

async function postDelivery(
  config: DeliveryClientConfig,
  notify: Notify,
  key: string,
  eventType: CaptureEventType,
  scope: Scope,
  journeyId: string | undefined,
  attempt: PendingAttempt,
): Promise<CaptureDelivery> {
  const { eventId, occurredAt } = attempt;
  try {
    const response = await fetch(config.collectPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        schemaVersion: BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION,
        eventId,
        eventType,
        occurredAt,
        ...(journeyId ? { journeyId } : {}),
        journeyIdentityScope: config.journeyIdentityScope,
        collectionPostureObservation: config.collectionPostureObservation,
        ...(eventType === "source_touch" && config.verification
          ? { verification: config.verification }
          : {}),
        scope,
      }),
    });
    const responseBody =
      typeof response.json === "function"
        ? ((await response.json().catch(() => null)) as Record<
            string,
            unknown
          > | null)
        : null;
    if (response.ok && responseBody?.blocked === true) {
      if (
        !["visitor_choice_denies", "collection_policy_withholds"].includes(
          String(responseBody.reason),
        )
      ) {
        return notify({
          eventType,
          eventId,
          status: "failed",
          reason: "http_error",
          httpStatus: response.status,
        });
      }
      markCompleted(key, eventId);
      return notify({
        eventType,
        eventId,
        status: "withheld",
        reason: responseBody.reason as CaptureDelivery["reason"],
        httpStatus: response.status,
      });
    }
    if (!response.ok) {
      const unavailable = [
        "collection_posture_stale",
        "collection_posture_not_configured",
        "collection_posture_capability_unavailable",
      ].includes(String(responseBody?.error));
      return notify({
        eventType,
        eventId,
        status: unavailable ? "unavailable" : "failed",
        reason: unavailable ? "collection_posture_unavailable" : "http_error",
        httpStatus: response.status,
      });
    }
    markCompleted(key, eventId);
    return notify({
      eventType,
      eventId,
      status: "delivered",
      httpStatus: response.status,
    });
  } catch {
    return notify({
      eventType,
      eventId,
      status: "failed",
      reason: "network_error",
    });
  }
}

async function sendDelivery(
  config: DeliveryClientConfig,
  notify: Notify,
  eventType: CaptureEventType,
  scope: Scope,
  retryPending: boolean,
): Promise<CaptureDelivery> {
  if (typeof window === "undefined") {
    return notify({
      eventType,
      status: "skipped",
      reason: "browser_unavailable",
    });
  }
  const observation = config.collectionPostureObservation;
  const journeyIdentityScope = config.journeyIdentityScope;
  if (!observation || !journeyIdentityScope) {
    return notify({
      eventType,
      status: "unavailable",
      reason: "collection_posture_unavailable",
    });
  }
  const journeyId = scope.fonte_journey_id;
  if (journeyIdentityScope === "persistent_first_party" && !journeyId) {
    return notify({
      eventType,
      status: "skipped",
      reason: "missing_journey_id",
    });
  }
  const key = await pendingAttemptKey(
    config.sentStoragePrefix,
    observation,
    eventType,
    scope,
  );
  let status = "";
  try {
    status = window.sessionStorage.getItem(key) ?? "";
  } catch {
    // In-memory guards still apply when session storage is unavailable.
  }
  if (status.startsWith("sent:"))
    markCompleted(key, status.slice("sent:".length));
  if (completed.has(key)) {
    return notify({ eventType, status: "skipped", reason: "duplicate" });
  }
  if (
    (pendingAttempts.has(key) || status.startsWith("pending:")) &&
    !retryPending
  ) {
    return notify({ eventType, status: "skipped", reason: "in_flight" });
  }
  const attempt = parsePendingAttempt(status) ??
    pendingAttempts.get(key) ?? {
      eventId: createClientAttemptId(),
      occurredAt: new Date().toISOString(),
    };
  pendingAttempts.set(key, attempt);
  try {
    window.sessionStorage.setItem(key, `pending:${JSON.stringify(attempt)}`);
  } catch {
    // The in-memory attempt preserves retry identity during this page life.
  }
  return postDelivery(
    config,
    notify,
    key,
    eventType,
    scope,
    journeyId,
    attempt,
  );
}

export function createDeliveryClient(
  config: DeliveryClientConfig,
): DeliveryClient {
  const notify: Notify = (delivery) => {
    try {
      config.onDelivery?.(delivery);
    } catch {
      // Installer diagnostics cannot change delivery behavior.
    }
    return delivery;
  };
  return {
    notify,
    send: (eventType, scope, retryPending) =>
      sendDelivery(config, notify, eventType, scope, retryPending),
  };
}
