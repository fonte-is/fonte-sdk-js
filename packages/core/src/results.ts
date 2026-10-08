import { createHash, createHmac, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { createApplicationDelivery } from "./application-delivery.js";
import { postHogCapture } from "./results-posthog.js";
import {
  nativeId,
  nativeInstant,
  nativeObject,
  normalizeNativeRecord,
} from "./results-types.js";
import type {
  AuthenticatedAppUser,
  Fonte,
  FonteBrowserIdentity,
  FonteIdentityClaims,
  FonteIdentityHandle,
  FonteIdentifyOptions,
  FonteMeasurementPermission,
  FonteObservationOptions,
  FonteOptions,
  FontePostHogTriggerOptions,
  FonteRetractInput,
  IdentityRecord,
} from "./results-types.js";

export type {
  AuthenticatedAppUser,
  IdentityRecord,
  ReturnRecord,
  TriggerRecord,
  TriggerRetraction,
  NativeTriggerRecord,
  FonteIdentityClaims,
  FonteBrowserIdentity,
  FonteObservationOptions,
  FontePostHogTriggerOptions,
  FontePostHogCapture,
  FontePostHogWitness,
  FonteIdentifyOptions,
  FonteMeasurementPermission,
  FonteRetractInput,
  FonteOptions,
  FonteIdentityHandle,
  Fonte,
} from "./results-types.js";
export type {
  ApplicationDeliveryStatus,
  ApplicationDeliveryReason,
} from "./application-types.js";

function allowed(value: unknown): boolean {
  try {
    return (
      value !== null &&
      typeof value === "object" &&
      (value as Record<string, unknown>).measurementAllowed === true
    );
  } catch {
    return false;
  }
}
function observation(
  value: unknown,
  now: number,
): { eventId: unknown; occurredAt: unknown } {
  const v = nativeObject(value, ["eventId", "occurredAt"], []);
  return {
    eventId: v.eventId === undefined ? randomUUID() : v.eventId,
    occurredAt:
      v.occurredAt === undefined ? new Date(now).toISOString() : v.occurredAt,
  };
}

/** Server-only, request-local identity handles over the existing installation credential.
 * Delivery is best effort before ACK; process loss can lose queued observations.
 */
export function createFonte(options: FonteOptions): Fonte {
  if (typeof window !== "undefined")
    throw new Error("fonte_results_server_only");
  try {
    return fonte(options);
  } catch {
    throw new Error("fonte_results_configuration_invalid");
  }
}
function fonte(options: FonteOptions): Fonte {
  const configuration = {
    ...nativeObject(
      options,
      [
        "installationId",
        "serverKey",
        "apiOrigin",
        "fetch",
        "now",
        "queueLimit",
        "batchSize",
        "timeoutMs",
        "flushDelayMs",
        "retryBaseMs",
        "maxRetries",
        "allowInsecureLocalhost",
      ],
      ["installationId", "serverKey"],
    ),
  } as unknown as FonteOptions;
  const installationId = nativeId(configuration.installationId);
  const delivery = createApplicationDelivery(
    { ...configuration, sourceId: installationId, mode: "application-v2" },
    normalizeNativeRecord,
  );
  const signingKey = createHash("sha256")
    .update(configuration.serverKey, "utf8")
    .digest();
  const stopped = () => ["closed", "blocked"].includes(delivery.status().state);
  const identify = (
    user: AuthenticatedAppUser,
    options: FonteIdentifyOptions,
  ): FonteIdentityHandle | null => {
    if (!delivery.gate(allowed(options))) return null;
    try {
      const v = nativeObject(
        options,
        ["measurementAllowed", "eventId", "occurredAt", "validUntil"],
        ["measurementAllowed"],
      );
      const now = delivery.clock(),
        original = observation(
          { eventId: v.eventId, occurredAt: v.occurredAt },
          now,
        );
      const occurredAt = nativeInstant(original.occurredAt);
      const record = normalizeNativeRecord(
        {
          kind: "identify",
          ...original,
          occurredAt,
          validUntil:
            v.validUntil === undefined
              ? new Date(Date.parse(occurredAt) + 900_000).toISOString()
              : v.validUntil,
          user,
        },
        now,
      ) as IdentityRecord;
      Object.freeze(record.user);
      Object.freeze(record);
      const claims: FonteIdentityClaims = {
        schema: "fonte.identity.v1",
        installationId,
        identity: record,
        measurementAllowed: true,
      };
      const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString(
        "base64url",
      );
      const identityToken = `${encoded}.${createHmac("sha256", signingKey).update(encoded, "utf8").digest("base64url")}`;
      if (Buffer.byteLength(identityToken, "utf8") > 4096) {
        delivery.reject("record_invalid");
        return null;
      }
      if (!delivery.enqueue(record, true)) return null;
      const acknowledgement = delivery.acknowledgement(record.eventId);
      if (!acknowledgement) return null;
      const browserIdentity: FonteBrowserIdentity = Object.freeze({
        installationId,
        identityToken,
        userId: record.user.id,
        identityEventId: record.eventId,
        validUntil: record.validUntil,
      });
      const valid = (now: number) =>
        !stopped() && now < Date.parse(record.validUntil);
      const activity = (
        kind: "return" | "trigger",
        key: unknown,
        input: FonteObservationOptions = {},
      ): boolean => {
        if (!delivery.gate(true)) return false;
        try {
          const now = delivery.clock();
          // A trusted server can redeliver an original committed action after restart.
          // Its original UUID/time and exact durable identity ACK are mandatory;
          // current actions and browser/foreground authority still expire normally.
          const replay = kind === "trigger" && !stopped()
            && Object.hasOwn(input, "eventId") && input.eventId !== undefined
            && Object.hasOwn(input, "occurredAt") && input.occurredAt !== undefined
            && acknowledgement.sourceRevision !== null
            && ["stored", "replayed"].includes(acknowledgement.outcome ?? "");
          if (!valid(now) && !replay) return delivery.reject("record_invalid");
          const original = observation(input, now);
          const activity = normalizeNativeRecord(
            {
              kind,
              ...original,
              userId: record.user.id,
              identityEventId: record.eventId,
              ...(kind === "return"
                ? { foreground: true }
                : { trigger: key, successful: true }),
            },
            now,
          );
          const at = Date.parse(activity.occurredAt);
          if (
            at < Date.parse(record.occurredAt) ||
            at >= Date.parse(record.validUntil)
          )
            return delivery.reject("record_invalid");
          return delivery.enqueue(activity, true);
        } catch {
          return delivery.reject("record_invalid");
        }
      };
      const postHogTrigger = (key: string, input: FontePostHogTriggerOptions) => {
          if (!delivery.gate(true)) return null;
          try {
            const now = delivery.clock();
            if (!valid(now) || acknowledgement.sourceRevision === null
              || !["stored", "replayed"].includes(acknowledgement.outcome ?? "")) throw 0;
            return postHogCapture(installationId, signingKey, record, key, input, now,
              acknowledgement.sourceRevision);
          } catch {
            delivery.reject("record_invalid");
            return null;
          }
      };
      return Object.freeze({
        trigger: (key: string, input?: FonteObservationOptions) =>
          activity("trigger", key, input),
        postHogTrigger,
        postHogWitness: (key: string, input: FontePostHogTriggerOptions) =>
          postHogTrigger(key, input)?.properties ?? null,
        returned: (input?: FonteObservationOptions) =>
          activity("return", undefined, input),
        get browserIdentity() {
          try {
            return valid(delivery.clock()) ? browserIdentity : null;
          } catch {
            return null;
          }
        },
      });
    } catch {
      delivery.reject("record_invalid");
      return null;
    }
  };
  return Object.freeze({
    identify,
    retract(input: FonteRetractInput, permission: FonteMeasurementPermission) {
      if (!delivery.gate(allowed(permission))) return false;
      try {
        nativeObject(permission, ["measurementAllowed"]);
        const v = nativeObject(
          input,
          ["targetId", "reason", "eventId", "occurredAt"],
          ["targetId", "reason"],
        );
        return delivery.enqueue(
          {
            kind: "retract",
            ...observation(
              { eventId: v.eventId, occurredAt: v.occurredAt },
              delivery.clock(),
            ),
            targetId: v.targetId,
            reason: v.reason,
          },
          true,
        );
      } catch {
        return delivery.reject("record_invalid");
      }
    },
    flush: delivery.flush,
    status: delivery.status,
    close: delivery.close,
  });
}
