import { randomUUID } from "node:crypto";
import { createApplicationDelivery } from "./application-delivery.js";
import type {
  ApplicationPermission,
  ApplicationRecord,
  FonteApplicationSource,
  FonteApplicationSourceOptions,
} from "./application-types.js";

export type * from "./application-types.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idPattern = /^[a-zA-Z0-9_.:-]{1,200}$/;
const instantPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const recoveryAgeMs = 30 * 86_400_000;
const futureSkewMs = 300_000;
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw 0;
  return value as ObjectValue;
}
function keys(value: ObjectValue, names: string[]): void {
  if (
    names.some((name) => !Object.hasOwn(value, name)) ||
    Object.keys(value).some((name) => !names.includes(name))
  )
    throw 0;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw 0;
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw 0;
  return value.toLowerCase();
}
function nullableId(value: unknown): string | null {
  return value === null ? null : id(value);
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw 0;
  return value;
}
function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !instantPattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw 0;
  const canonical = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_whole, digits: string | undefined) =>
      `.${(digits ?? "000").padEnd(3, "0")}Z`,
  );
  if (new Date(value).toISOString() !== canonical) throw 0;
  return canonical;
}
function normalizeRecord(value: unknown, now: number): ApplicationRecord {
  const v = object(value),
    eventId = uuid(v.eventId);
  if (v.kind === "relationship") {
    keys(v, [
      "kind",
      "eventId",
      "userId",
      "contactId",
      "accountId",
      "sourcePartyId",
      "validFrom",
      "validUntil",
      "state",
    ]);
    const validFrom = instant(v.validFrom),
      validUntil = v.validUntil === null ? null : instant(v.validUntil);
    if (validUntil !== null && Date.parse(validUntil) <= Date.parse(validFrom))
      throw 0;
    if (
      v.state !== "verified" &&
      v.state !== "revoked" &&
      v.state !== "conflicting"
    )
      throw 0;
    return {
      kind: v.kind,
      eventId,
      userId: id(v.userId),
      contactId: id(v.contactId),
      accountId: nullableId(v.accountId),
      sourcePartyId: v.sourcePartyId === null ? null : uuid(v.sourcePartyId),
      validFrom,
      validUntil,
      state: v.state,
    };
  }
  const occurredAt = instant(v.occurredAt),
    at = Date.parse(occurredAt);
  if (at < now - recoveryAgeMs || at > now + futureSkewMs) throw 0;
  const common = ["kind", "eventId", "occurredAt"];
  if (v.kind === "access" || v.kind === "action") {
    keys(v, [
      ...common,
      "userId",
      "accountId",
      "actor",
      ...(v.kind === "action" ? ["action", "successful"] : []),
    ]);
    if (v.actor !== "user" && v.actor !== "background") throw 0;
    const base = {
      eventId,
      occurredAt,
      userId: id(v.userId),
      accountId: nullableId(v.accountId),
      actor: v.actor as "user" | "background",
    };
    return v.kind === "access"
      ? { kind: v.kind, ...base }
      : {
          kind: v.kind,
          ...base,
          action: id(v.action),
          successful: boolean(v.successful),
        };
  }
  if (v.kind === "upgrade") {
    keys(v, [
      ...common,
      "accountId",
      "previousPlan",
      "effectivePlan",
      "state",
      "priorStateVerified",
    ]);
    if (v.state !== "effective" && v.state !== "pending") throw 0;
    return {
      kind: v.kind,
      eventId,
      occurredAt,
      accountId: id(v.accountId),
      previousPlan: nullableId(v.previousPlan),
      effectivePlan: id(v.effectivePlan),
      state: v.state,
      priorStateVerified: boolean(v.priorStateVerified),
    };
  }
  if (v.kind === "retract") {
    keys(v, [...common, "targetId", "reason"]);
    if (v.reason !== "correction" && v.reason !== "withdrawn") throw 0;
    const targetId = uuid(v.targetId);
    if (targetId === eventId) throw 0;
    return { kind: v.kind, eventId, occurredAt, targetId, reason: v.reason };
  }
  throw 0;
}
function permitted(value: unknown): boolean {
  try {
    const v = object(value);
    return v.activity === "granted" && v.identityLink === "granted";
  } catch {
    return false;
  }
}
/** Server-only adapter. Existing authentication, business state and permissions remain caller-owned. */
export function createFonteApplicationSource(
  options: FonteApplicationSourceOptions,
): FonteApplicationSource {
  if (typeof window !== "undefined")
    throw new Error("fonte_application_server_only");
  try {
    return applicationSource(options);
  } catch {
    throw new Error("fonte_application_configuration_invalid");
  }
}
function applicationSource(
  options: FonteApplicationSourceOptions,
): FonteApplicationSource {
  const delivery = createApplicationDelivery(
    {
      mode: "application-v1",
      apiOrigin: options.apiOrigin,
      siteId: options.siteId,
      sourceId: options.sourceId,
      serverKey: options.serverKey,
      origin: options.origin,
      policyVersion: options.policyVersion,
      fetch: options.fetch,
      now: options.now,
      queueLimit: options.queueLimit,
      batchSize: options.batchSize,
      timeoutMs: options.timeoutMs,
      flushDelayMs: options.flushDelayMs,
      retryBaseMs: options.retryBaseMs,
      maxRetries: options.maxRetries,
      allowInsecureLocalhost: options.allowInsecureLocalhost,
    },
    normalizeRecord,
  );
  const { gate, reject, clock, flush, status, close } = delivery;
  const enqueue = (
    value: ApplicationRecord,
    permission: ApplicationPermission,
  ) => delivery.enqueue(value, permitted(permission));
  const hook = (
    kind: ApplicationRecord["kind"],
    input: unknown,
    permission: ApplicationPermission,
  ): boolean => {
    if (!gate(permitted(permission))) return false;
    try {
      const value = object(input),
        record: ObjectValue = {
          ...value,
          kind,
          eventId: value.eventId ?? randomUUID(),
        };
      if (kind !== "relationship")
        record.occurredAt = value.occurredAt ?? new Date(clock()).toISOString();
      if (kind === "access" || kind === "action" || kind === "relationship")
        record.accountId = value.accountId ?? null;
      if (kind === "access" || kind === "action")
        record.actor = value.actor ?? "user";
      if (kind === "relationship") {
        record.sourcePartyId = value.sourcePartyId ?? null;
        record.validUntil = value.validUntil ?? null;
      }
      return enqueue(record as ApplicationRecord, permission);
    } catch {
      return reject("record_invalid");
    }
  };
  return {
    enqueue,
    recordAccess: (input, permission) => hook("access", input, permission),
    recordAction: (input, permission) => hook("action", input, permission),
    recordRelationship: (input, permission) =>
      hook("relationship", input, permission),
    recordUpgrade: (input, permission) => hook("upgrade", input, permission),
    retract: (input, permission) => hook("retract", input, permission),
    flush,
    status,
    close,
  };
}
