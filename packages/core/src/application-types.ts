/** These records describe committed application facts supplied by its existing server. */
export type ApplicationPermission = {
  activity: "granted" | "denied" | "unknown";
  identityLink: "granted" | "denied" | "unknown";
};

export type ApplicationAccessRecord = {
  kind: "access";
  eventId: string;
  occurredAt: string;
  userId: string;
  accountId: string | null;
  actor: "user" | "background";
};
export type ApplicationActionRecord = {
  kind: "action";
  eventId: string;
  occurredAt: string;
  userId: string;
  accountId: string | null;
  actor: "user" | "background";
  action: string;
  successful: boolean;
};
export type ApplicationRelationshipRecord = {
  kind: "relationship";
  eventId: string;
  userId: string;
  contactId: string;
  accountId: string | null;
  sourcePartyId: string | null;
  validFrom: string;
  validUntil: string | null;
  state: "verified" | "revoked" | "conflicting";
};
export type ApplicationUpgradeRecord = {
  kind: "upgrade";
  eventId: string;
  occurredAt: string;
  accountId: string;
  previousPlan: string | null;
  effectivePlan: string;
  state: "effective" | "pending";
  priorStateVerified: boolean;
};
export type ApplicationRetractionRecord = {
  kind: "retract";
  eventId: string;
  occurredAt: string;
  targetId: string;
  reason: "correction" | "withdrawn";
};
export type ApplicationRecord =
  | ApplicationAccessRecord
  | ApplicationActionRecord
  | ApplicationRelationshipRecord
  | ApplicationUpgradeRecord
  | ApplicationRetractionRecord;

type TimedInput<T> = Omit<T, "kind" | "eventId" | "occurredAt"> & {
  eventId?: string;
  occurredAt?: string;
};
export type ApplicationAccessInput = Omit<
  TimedInput<ApplicationAccessRecord>,
  "accountId" | "actor"
> & { accountId?: string | null; actor?: "user" | "background" };
export type ApplicationActionInput = Omit<
  TimedInput<ApplicationActionRecord>,
  "accountId" | "actor"
> & { accountId?: string | null; actor?: "user" | "background" };
export type ApplicationRelationshipInput = Omit<
  ApplicationRelationshipRecord,
  "kind" | "eventId" | "accountId" | "sourcePartyId" | "validUntil"
> & {
  eventId?: string;
  accountId?: string | null;
  sourcePartyId?: string | null;
  validUntil?: string | null;
};
export type ApplicationUpgradeInput = TimedInput<ApplicationUpgradeRecord>;
export type ApplicationRetractionInput =
  TimedInput<ApplicationRetractionRecord>;

export interface FonteApplicationSourceOptions {
  /** Canonical HTTPS origin, without a path, query, or credentials. */
  apiOrigin?: string;
  siteId: string;
  sourceId: string;
  /** Server credential; never place this client or its configuration in browser code. */
  serverKey: string;
  /** The exact application origin selected in the existing Website installation. */
  origin: string;
  policyVersion: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Optional lower limits for small hosts/tests; these cannot increase product limits. */
  queueLimit?: number;
  batchSize?: number;
  timeoutMs?: number;
  flushDelayMs?: number;
  retryBaseMs?: number;
  /** At most three retries after the first attempt, per flush cycle. */
  maxRetries?: number;
  /** HTTP is permitted only for an explicitly selected loopback development endpoint. */
  allowInsecureLocalhost?: boolean;
}

export type ApplicationDeliveryReason =
  | "collection_not_permitted"
  | "record_invalid"
  | "record_conflict"
  | "queue_full"
  | "request_timeout"
  | "network_unavailable"
  | "receipt_unconfirmed"
  | "source_denied"
  | "source_conflict"
  | "source_rejected"
  | "source_unavailable"
  | "retry_later"
  | "closed";

export interface ApplicationDeliveryStatus {
  delivery: "best_effort";
  state: "ready" | "delivering" | "disconnected" | "blocked" | "closed";
  queued: number;
  enqueued: number;
  acknowledged: number;
  stored: number;
  replayed: number;
  erased: number;
  dropped: number;
  denied: number;
  rejected: number;
  requests: number;
  retries: number;
  retryAfterMs: number;
  lastReason: ApplicationDeliveryReason | null;
}

export interface FonteApplicationSource {
  /** Synchronous, best effort; false means this record was not queued. */
  enqueue(
    record: ApplicationRecord,
    permission: ApplicationPermission,
  ): boolean;
  recordAccess(
    input: ApplicationAccessInput,
    permission: ApplicationPermission,
  ): boolean;
  recordAction(
    input: ApplicationActionInput,
    permission: ApplicationPermission,
  ): boolean;
  recordRelationship(
    input: ApplicationRelationshipInput,
    permission: ApplicationPermission,
  ): boolean;
  recordUpgrade(
    input: ApplicationUpgradeInput,
    permission: ApplicationPermission,
  ): boolean;
  retract(
    input: ApplicationRetractionInput,
    permission: ApplicationPermission,
  ): boolean;
  /** Optional lifecycle drain; business operations must not await this. Never rejects. */
  flush(): Promise<ApplicationDeliveryStatus>;
  status(): ApplicationDeliveryStatus;
  /** Abort delivery and drop unacknowledged in-memory records. Idempotent. */
  close(): ApplicationDeliveryStatus;
}
