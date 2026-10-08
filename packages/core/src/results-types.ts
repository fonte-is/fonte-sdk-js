import type {
  ApplicationDeliveryStatus,
  FonteApplicationSourceOptions,
} from "./application-types.js";

/** Facts supplied by the application's existing authenticated session. */
export interface AuthenticatedAppUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}
export interface IdentityRecord {
  readonly kind: "identify";
  readonly eventId: string;
  readonly occurredAt: string;
  readonly validUntil: string;
  readonly user: AuthenticatedAppUser;
}
export interface ReturnRecord {
  readonly kind: "return";
  readonly eventId: string;
  readonly occurredAt: string;
  readonly userId: string;
  readonly identityEventId: string;
  readonly foreground: true;
}
export interface TriggerRecord {
  readonly kind: "trigger";
  readonly eventId: string;
  readonly occurredAt: string;
  readonly userId: string;
  readonly identityEventId: string;
  readonly trigger: string;
  readonly successful: boolean;
}
export interface TriggerRetraction {
  readonly kind: "retract";
  readonly eventId: string;
  readonly occurredAt: string;
  readonly targetId: string;
  readonly reason: "correction" | "withdrawn";
}
export type NativeTriggerRecord =
  IdentityRecord | ReturnRecord | TriggerRecord | TriggerRetraction;
export interface FonteIdentityClaims {
  readonly schema: "fonte.identity.v1";
  readonly installationId: string;
  readonly identity: IdentityRecord;
  readonly measurementAllowed: true;
}
/** Short-lived bearer data. Keep it out of logs, persistent storage and shared sessions. */
export interface FonteBrowserIdentity {
  readonly installationId: string;
  readonly identityToken: string;
  readonly userId: string;
  readonly identityEventId: string;
  readonly validUntil: string;
}
export interface FonteObservationOptions {
  readonly eventId?: string;
  readonly occurredAt?: string;
}
export interface FontePostHogTriggerOptions {
  readonly projectId: string;
  readonly event: string;
  /** Optional compatibility assertion. Must match this identity's acknowledged Source revision. */
  readonly sourceRevision?: number;
  /** Original committed operation UUID and time; retain both for provider retries. */
  readonly eventId: string;
  readonly occurredAt: string;
}
/** Server capture input. No Source key, email, person profile or browser authority. */
export interface FontePostHogCapture {
  readonly event: string;
  readonly uuid: string;
  readonly distinctId: string;
  readonly timestamp: Date;
  readonly properties: { readonly fonte_commit: string };
}
export interface FonteIdentifyOptions extends FonteObservationOptions {
  readonly measurementAllowed: boolean;
  readonly validUntil?: string;
}
export interface FonteMeasurementPermission {
  readonly measurementAllowed: boolean;
}
export interface FonteRetractInput extends FonteObservationOptions {
  readonly targetId: string;
  readonly reason: "correction" | "withdrawn";
}
export interface FonteOptions extends Omit<
  FonteApplicationSourceOptions,
  "siteId" | "sourceId" | "origin" | "policyVersion"
> {
  installationId: string;
}
export interface FonteIdentityHandle {
  /** Call only after the authoritative operation commits successfully. Replays reuse its UUID and time. */
  trigger(key: string, options?: FonteObservationOptions): boolean;
  /** After commit and this identity's durable ACK. Uses its acknowledged Source revision; no native trigger enqueue. */
  postHogTrigger(key: string, options: FontePostHogTriggerOptions): FontePostHogCapture | null;
  /** Current authenticated foreground activity. */
  returned(options?: FonteObservationOptions): boolean;
  readonly browserIdentity: FonteBrowserIdentity | null;
}
export interface Fonte {
  /** Synchronous best effort. Explicit permission is checked before reading the user. */
  identify(
    user: AuthenticatedAppUser,
    options: FonteIdentifyOptions,
  ): FonteIdentityHandle | null;
  retract(
    input: FonteRetractInput,
    permission: FonteMeasurementPermission,
  ): boolean;
  /** Optional lifecycle drain. Never await this in a successful business operation. Never rejects. */
  flush(): Promise<ApplicationDeliveryStatus>;
  status(): ApplicationDeliveryStatus;
  close(): ApplicationDeliveryStatus;
}
export interface FonteReturnOptions {
  apiOrigin?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  allowInsecureLocalhost?: boolean;
}

// Internal wire normalization shared by the server and browser entrypoints. No state or authority lookup.
export function nativeObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw 0;
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  )
    throw 0;
  return value as Record<string, unknown>;
}
export function nativeId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value))
    throw 0;
  return value;
}
export function nativeUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw 0;
  return value.toLowerCase();
}
export function nativeInstant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
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
function observed(value: unknown, now: number): string {
  const at = nativeInstant(value);
  if (
    !Number.isFinite(now) ||
    Date.parse(at) < now - 30 * 86_400_000 ||
    Date.parse(at) > now + 300_000
  )
    throw 0;
  return at;
}
function email(value: unknown): string {
  if (typeof value !== "string") throw 0;
  // Match Core's existing normalizeEmailAddress; this is syntax, never proof of verification.
  const normalized = value.trim().toLowerCase(),
    parts = normalized.split("@");
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    /\s/.test(normalized) ||
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    !parts[1].includes(".")
  )
    throw 0;
  return normalized;
}
export function normalizeNativeRecord(
  value: unknown,
  now: number,
): NativeTriggerRecord {
  if (value === null || typeof value !== "object") throw 0;
  const kind = (value as Record<string, unknown>).kind;
  const base = ["kind", "eventId", "occurredAt"];
  if (kind === "identify") {
    const v = nativeObject(value, [...base, "validUntil", "user"]);
    const eventId = nativeUuid(v.eventId),
      occurredAt = observed(v.occurredAt, now),
      validUntil = nativeInstant(v.validUntil);
    const lifetime = Date.parse(validUntil) - Date.parse(occurredAt);
    if (lifetime <= 0 || lifetime > 900_000) throw 0;
    const u = nativeObject(v.user, ["id", "email", "emailVerified"]);
    if (typeof u.emailVerified !== "boolean") throw 0;
    return {
      kind,
      eventId,
      occurredAt,
      validUntil,
      user: {
        id: nativeId(u.id),
        email: email(u.email),
        emailVerified: u.emailVerified,
      },
    };
  }
  if (kind === "return" || kind === "trigger") {
    const v = nativeObject(value, [
      ...base,
      "userId",
      "identityEventId",
      ...(kind === "return" ? ["foreground"] : ["trigger", "successful"]),
    ]);
    const common = {
      eventId: nativeUuid(v.eventId),
      occurredAt: observed(v.occurredAt, now),
      userId: nativeId(v.userId),
      identityEventId: nativeUuid(v.identityEventId),
    };
    if (kind === "return") {
      if (v.foreground !== true) throw 0;
      return { kind, ...common, foreground: true };
    }
    if (
      typeof v.trigger !== "string" ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(v.trigger) ||
      typeof v.successful !== "boolean"
    )
      throw 0;
    return { kind, ...common, trigger: v.trigger, successful: v.successful };
  }
  if (kind === "retract") {
    const v = nativeObject(value, [...base, "targetId", "reason"]);
    const eventId = nativeUuid(v.eventId),
      targetId = nativeUuid(v.targetId),
      occurredAt = observed(v.occurredAt, now);
    if (
      eventId === targetId ||
      (v.reason !== "correction" && v.reason !== "withdrawn")
    )
      throw 0;
    return { kind, eventId, occurredAt, targetId, reason: v.reason };
  }
  throw 0;
}
