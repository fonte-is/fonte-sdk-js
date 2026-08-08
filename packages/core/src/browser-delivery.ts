import type { InstallationVerificationMetadata } from "./installation-verification.js";
import { createClientAttemptId } from "./ids.js";
import { clean } from "./collect-contract.js";
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

export function createDeliveryClient(
  config: DeliveryClientConfig,
): DeliveryClient {
  const notify = (delivery: CaptureDelivery): CaptureDelivery => {
    try {
      config.onDelivery?.(delivery);
    } catch {
      // Installer diagnostics cannot change delivery behavior.
    }
    return delivery;
  };

  const send = async (
    eventType: CaptureEventType,
    scope: Scope,
    retryPending: boolean,
  ): Promise<CaptureDelivery> => {
    if (typeof window === "undefined") {
      return notify({
        eventType,
        status: "skipped",
        reason: "browser_unavailable",
      });
    }

    const journeyId = scope.fonte_journey_id;
    if (!journeyId) {
      return notify({
        eventType,
        status: "skipped",
        reason: "missing_journey_id",
      });
    }

    const key = `${config.sentStoragePrefix}:${eventType}:${scope.current_url.slice(0, 1000)}`;
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

    const storedEventId = status.startsWith("pending:")
      ? clean(status.slice("pending:".length), 80).toLowerCase()
      : "";
    const eventId = uuidPattern.test(storedEventId)
      ? storedEventId
      : createClientAttemptId();
    pending.add(key);
    try {
      window.sessionStorage.setItem(key, `pending:${eventId}`);
    } catch {
      // The in-memory guard prevents duplicate posts during this page life.
    }

    try {
      const response = await fetch(config.collectPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          eventId,
          eventType,
          journeyId,
          ...(eventType === "source_touch" && config.verification
            ? { verification: config.verification }
            : {}),
          scope,
        }),
      });
      if (!response.ok) {
        return notify({
          eventType,
          eventId,
          status: "failed",
          reason: "http_error",
          httpStatus: response.status,
        });
      }
      completed.add(key);
      try {
        window.sessionStorage.setItem(key, `sent:${eventId}`);
      } catch {
        // completed remains authoritative for this page life.
      }
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
    } finally {
      pending.delete(key);
    }
  };

  return { notify, send };
}
