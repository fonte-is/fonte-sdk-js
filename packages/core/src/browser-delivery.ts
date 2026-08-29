import type { InstallationVerificationMetadata } from "./installation-verification.js";
import { createClientAttemptId } from "./ids.js";
import { clean } from "./collect-contract.js";
import {
  BROWSER_TOUCH_OBSERVATION_SCHEMA_VERSION,
  type JourneyIdentityScope,
} from "./collect-types.js";
import type { CollectionPostureObservation } from "./collection-posture.js";
import type { CaptureDelivery, CaptureEventType } from "./browser-types.js";
import type { Scope } from "./types.js";

const pending = new Set<string>();
const completed = new Set<string>();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DeliveryClientConfig {
  collectPath: string;
  sentStoragePrefix: string;
  verification: InstallationVerificationMetadata | null;
  collectionPostureObservation: CollectionPostureObservation | null;
  journeyIdentityScope: JourneyIdentityScope | null;
  onDelivery?: (delivery: CaptureDelivery) => void;
}

interface PendingAttempt {
  eventId: string;
  occurredAt: string;
}

const parsePendingAttempt = (value: string): PendingAttempt | null => {
  if (!value.startsWith("pending:")) return null;
  try {
    const parsed = JSON.parse(value.slice("pending:".length)) as Record<
      string,
      unknown
    >;
    if (
      Object.keys(parsed).length !== 2 ||
      !uuidPattern.test(clean(parsed.eventId, 80)) ||
      typeof parsed.occurredAt !== "string" ||
      new Date(parsed.occurredAt).toISOString() !== parsed.occurredAt
    )
      return null;
    return {
      eventId: clean(parsed.eventId, 80).toLowerCase(),
      occurredAt: parsed.occurredAt,
    };
  } catch {
    return null;
  }
};

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
  const key = [
    config.sentStoragePrefix,
    observation.policyVersion,
    observation.visitorChoice,
    eventType,
    scope.current_url.slice(0, 1000),
  ].join(":");
  let status = "";
  try {
    status = window.sessionStorage.getItem(key) ?? "";
  } catch {
    // In-memory guards still apply when session storage is unavailable.
  }
  if (completed.has(key) || status.startsWith("sent:")) {
    return notify({ eventType, status: "skipped", reason: "duplicate" });
  }
  if ((pending.has(key) || status.startsWith("pending:")) && !retryPending) {
    return notify({ eventType, status: "skipped", reason: "in_flight" });
  }
  const attempt = parsePendingAttempt(status) ?? {
    eventId: createClientAttemptId(),
    occurredAt: new Date().toISOString(),
  };
  pending.add(key);
  try {
    window.sessionStorage.setItem(key, `pending:${JSON.stringify(attempt)}`);
  } catch {
    // The in-memory guard prevents duplicate posts during this page life.
  }
  try {
    return await postDelivery(
      config,
      notify,
      key,
      eventType,
      scope,
      journeyId,
      attempt,
    );
  } finally {
    pending.delete(key);
  }
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
