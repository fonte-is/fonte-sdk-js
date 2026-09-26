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
export type BrowserObservationTransport = (
  body: CollectBody,
  signal: AbortSignal,
) => Promise<{ httpStatus: number; receipt: unknown }>;
interface DeliveryConfig {
  collectPath: string;
  transport?: BrowserObservationTransport;
  policy: () => CollectionPolicy | null;
  onDelivery?: (delivery: CaptureDelivery) => void;
}

const receiptObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function durableReceipt(
  value: unknown,
  eventId: string,
): value is CollectionReceipt {
  const receipt = receiptObject(value);
  return Boolean(
    receipt &&
    receipt.eventId === eventId &&
    (receipt.disposition === "accepted" ||
      receipt.disposition === "duplicate_of_accepted") &&
    typeof receipt.recordId === "string" &&
    receipt.recordId.length > 0 &&
    receipt.recordId.length <= 160 &&
    typeof receipt.receivedAt === "string" &&
    Number.isFinite(Date.parse(receipt.receivedAt)),
  );
}
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freezeSnapshot(nested);
    Object.freeze(value);
  }
  return value;
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
      const current = config.policy();
      // Synchronous transport callbacks can withdraw between one arrival's snapshots.
      // Reject before storing the second snapshot after the first cleared the queue.
      if (
        !permitted(current) ||
        current.version !== body.collectionVersion ||
        policyKey(current) !== policyKey(policy)
      )
        return Promise.resolve(
          notify({
            eventType: body.eventType,
            eventId: body.eventId,
            occurrenceId: body.occurrenceId,
            status: "skipped",
            reason: "collection_not_permitted",
          }),
        );
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
      const owned = [...controllers];
      controllers.clear();
      pending.clear();
      for (const controller of owned) controller.abort();
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
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const canceled = new Promise<never>((_, reject) => {
        abort = () => reject(Error("fonte_observation_aborted"));
        controller.signal.addEventListener("abort", abort, { once: true });
        timeout = setTimeout(() => controller.abort(), 3000);
      });
      const transmit = async () => {
        if (config.transport)
          return config.transport(
            freezeSnapshot(JSON.parse(a.json) as CollectBody),
            controller.signal,
          );
        const response = await fetch(config.collectPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: a.json,
          signal: controller.signal,
          credentials: "same-origin",
        });
        return {
          httpStatus: response.status,
          receipt: (await response.json().catch(() => null)) as unknown,
        };
      };
      const response = await Promise.race([transmit(), canceled]);
      if (
        !Number.isInteger(response.httpStatus) ||
        response.httpStatus < 100 ||
        response.httpStatus > 599
      )
        throw Error("fonte_observation_invalid_http_status");
      const receipt = response.receipt;
      const disposition = receiptObject(receipt)?.disposition;
      const ok = response.httpStatus >= 200 && response.httpStatus < 300;
      // Withdrawal/reset during an in-flight request must not repopulate active context.
      const currentPolicy = config.policy();
      if (
        controller.signal.aborted ||
        !permitted(currentPolicy) ||
        policyKey(currentPolicy) !== a.policy
      )
        return notify(result(a, "skipped", "collection_not_permitted"));
      if (ok && durableReceipt(receipt, a.body.eventId)) {
        a.terminal = true;
        return notify({
          ...result(a, "delivered"),
          httpStatus: response.httpStatus,
          receipt,
        });
      }
      if (disposition === "ignored" || disposition === "rejected") {
        a.terminal = true;
        return notify({
          ...result(
            a,
            disposition === "ignored" ? "skipped" : "failed",
            disposition,
          ),
          httpStatus: response.httpStatus,
        });
      }
      if (
        response.httpStatus >= 400 &&
        response.httpStatus < 500 &&
        ![408, 429].includes(response.httpStatus)
      )
        a.terminal = true;
      return notify({
        ...result(a, "failed", ok ? "receipt_unavailable" : "http_error"),
        httpStatus: response.httpStatus,
      });
    } catch {
      return notify(result(a, "failed", "network_error"));
    } finally {
      a.active = false;
      controllers.delete(controller);
      if (timeout !== undefined) clearTimeout(timeout);
      if (abort) controller.signal.removeEventListener("abort", abort);
    }
  };
}
