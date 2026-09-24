import type {
  CaptureDelivery,
  CaptureDeliveryReason,
} from "./browser-types.js";
import type { CollectBody, CollectionReceipt } from "./collect-types.js";
import { permitted, type CollectionPolicy } from "./collection-policy.js";

type Attempt = {
  body: CollectBody;
  json: string;
  expiresAt: number;
  attempts: number;
  active: boolean;
  terminal: boolean;
  policy: string;
};
const MAX_PENDING = 32;
const MAX_ATTEMPTS = 3;
const MAX_AGE_MS = 30 * 60_000;
const policyKey = (policy: CollectionPolicy) =>
  JSON.stringify({ ...policy, expiresAt: undefined });
interface DeliveryConfig {
  collectPath: string;
  policy: () => CollectionPolicy | null;
  onDelivery?: (delivery: CaptureDelivery) => void;
}
export function createDeliveryClient(config: DeliveryConfig) {
  const pending = new Map<string, Attempt>();
  const controllers = new Set<AbortController>();
  const notify = (delivery: CaptureDelivery) => {
    try {
      config.onDelivery?.(delivery);
    } catch {
      /* diagnostics are not authority */
    }
    return delivery;
  };
  const send = createSender(config, controllers, notify);
  return {
    notify,
    submit(body: CollectBody, policy: CollectionPolicy) {
      // Bound this document's queue. No unbounded offline or cross-reload replay.
      for (const [id, a] of pending)
        if (a.terminal || a.expiresAt <= Date.now()) pending.delete(id);
      if (pending.size >= MAX_PENDING)
        return Promise.resolve(
          notify({
            eventType: body.eventType,
            status: "failed",
            reason: "retry_exhausted",
          }),
        );
      const json = JSON.stringify(body);
      const a: Attempt = {
        body: JSON.parse(json),
        json,
        expiresAt: Math.min(
          policy.expiresAt ?? Number.MAX_SAFE_INTEGER,
          Date.now() + MAX_AGE_MS,
        ),
        policy: policyKey(policy),
        attempts: 0,
        active: false,
        terminal: false,
      };
      pending.set(body.eventId, a);
      return send(a, false);
    },
    retry: () =>
      Promise.all(
        [...pending.values()]
          .filter((a) => !a.terminal)
          .map((a) => send(a, true)),
      ),
    reset() {
      for (const controller of controllers) controller.abort();
      pending.clear();
    },
  };
}

const result = (
  a: Attempt,
  status: CaptureDelivery["status"],
  reason?: CaptureDeliveryReason,
): CaptureDelivery => ({
  eventType: a.body.eventType,
  eventId: a.body.eventId,
  occurrenceId: a.body.occurrenceId,
  status,
  ...(reason ? { reason } : {}),
});

function createSender(
  config: DeliveryConfig,
  controllers: Set<AbortController>,
  notify: (delivery: CaptureDelivery) => CaptureDelivery,
) {
  return async (a: Attempt, retry: boolean): Promise<CaptureDelivery> => {
    const policy = config.policy();
    if (
      !permitted(policy) ||
      policy.version !== a.body.collectionVersion ||
      policyKey(policy) !== a.policy
    ) {
      a.terminal = true;
      return notify(result(a, "skipped", "collection_not_permitted"));
    }
    if (Date.now() >= a.expiresAt) {
      a.terminal = true;
      return notify(result(a, "skipped", "expired"));
    }
    if (a.active) return notify(result(a, "skipped", "in_flight"));
    if (a.terminal) return notify(result(a, "skipped", "duplicate"));
    if (a.attempts && !retry) return notify(result(a, "skipped", "in_flight"));
    if (a.attempts >= MAX_ATTEMPTS) {
      a.terminal = true;
      return notify(result(a, "failed", "retry_exhausted"));
    }
    a.active = true;
    a.attempts++;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(config.collectPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: a.json,
        signal: controller.signal,
        credentials: "same-origin",
      });
      const receipt = (await response
        .json()
        .catch(() => null)) as CollectionReceipt | null;
      // Withdrawal/reset during an in-flight request must not repopulate active context.
      const currentPolicy = config.policy();
      if (
        controller.signal.aborted ||
        !permitted(currentPolicy) ||
        policyKey(currentPolicy) !== a.policy
      )
        return notify(result(a, "skipped", "collection_not_permitted"));
      if (
        response.ok &&
        receipt?.eventId === a.body.eventId &&
        ["accepted", "duplicate_of_accepted"].includes(receipt.disposition) &&
        typeof receipt.recordId === "string" &&
        receipt.recordId.length > 0 &&
        receipt.recordId.length <= 160 &&
        typeof receipt.receivedAt === "string" &&
        Number.isFinite(Date.parse(receipt.receivedAt))
      ) {
        a.terminal = true;
        return notify({
          ...result(a, "delivered"),
          httpStatus: response.status,
          receipt,
        });
      }
      if (
        receipt?.disposition === "ignored" ||
        receipt?.disposition === "rejected"
      ) {
        a.terminal = true;
        return notify({
          ...result(
            a,
            receipt.disposition === "ignored" ? "skipped" : "failed",
            receipt.disposition,
          ),
          httpStatus: response.status,
        });
      }
      if (
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 429].includes(response.status)
      )
        a.terminal = true;
      return notify({
        ...result(
          a,
          "failed",
          response.ok ? "receipt_unavailable" : "http_error",
        ),
        httpStatus: response.status,
      });
    } catch {
      return notify(result(a, "failed", "network_error"));
    } finally {
      a.active = false;
      controllers.delete(controller);
      clearTimeout(timeout);
    }
  };
}
