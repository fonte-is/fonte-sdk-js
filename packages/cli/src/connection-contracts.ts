import { z } from "zod";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const connectionChoiceRef = z.string().regex(/^fcc_[a-f0-9]{64}$/);
export const connectionRef = z.string().regex(/^fc_[a-f0-9]{64}$/);
export const authorizationAttemptRef = z
  .string()
  .regex(new RegExp(`^fca_${uuid}$`));
export const contactSourceRef = z.string().regex(new RegExp(`^fs_${uuid}$`));
export const contactImportRef = z.string().regex(new RegExp(`^fi_${uuid}$`));
const label = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[^\p{Cc}]+$/u);
const instant = z.string().refine((value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
});
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const capability = z.enum(["contacts.read", "contacts.import"]);
const capabilities = z
  .array(capability)
  .refine((value) => new Set(value).size === value.length);

export const connectionChoice = z.strictObject({
  choiceRef: connectionChoiceRef,
  label,
  capabilities,
  status: z.enum(["available", "unavailable"]),
});
export const connection = z.strictObject({
  connectionRef,
  choiceRef: connectionChoiceRef.nullable(),
  accountLabel: label,
  status: z.enum([
    "ready",
    "reauthorization_required",
    "disconnected",
    "unknown",
  ]),
  capabilities,
  credentialVersion: count.positive(),
  verifiedAt: instant,
  updatedAt: instant,
});
const authorizationUrl = z
  .string()
  .max(4000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !/[\u0000-\u0020\u007f]/u.test(value)
      );
    } catch {
      return false;
    }
  });
export const connectionAuthorization = z
  .strictObject({
    attemptRef: authorizationAttemptRef,
    connectionRef: connectionRef.nullable(),
    status: z.enum(["waiting", "ready", "failed", "unknown"]),
    reason: z.enum([
      "authorization_pending",
      "connection_ready",
      "authorization_denied",
      "attempt_expired",
      "completion_unknown",
      "account_identity_unavailable",
      "account_mismatch",
      "connection_conflict",
    ]),
    nextAction: z
      .strictObject({ type: z.literal("open_url"), url: authorizationUrl })
      .nullable(),
    expiresAt: instant,
    pollAfterMilliseconds: count.min(250).max(5000),
    connection: connection.nullable(),
  })
  .refine(
    (value) =>
      (value.status === "ready") === (value.connection !== null) &&
      (value.connection === null ||
        value.connectionRef === value.connection.connectionRef) &&
      (value.nextAction === null || value.status === "waiting"),
  );

export const contactSource = z.strictObject({
  sourceRef: contactSourceRef,
  connectionRef,
  label,
});
export const contactSources = z
  .strictObject({
    observedAt: instant,
    coverage: z.literal("complete"),
    sources: z.array(contactSource),
  })
  .refine(
    (value) =>
      new Set(value.sources.map((source) => source.sourceRef)).size ===
      value.sources.length,
  );
export const contactSourcePreview = z.strictObject({
  source: contactSource,
  ready: z.boolean(),
  observedAt: instant.nullable(),
  observationFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  counts: z
    .strictObject({ source: count, protected: count, unknown: count })
    .nullable(),
  unavailableReasons: z.array(z.string().regex(/^[a-z0-9_]{1,100}$/)),
});
export const contactImportCounts = z.strictObject({
  total: count,
  processed: count,
  submitted: count,
  valid: count,
  invalid: count,
  duplicate: count,
  linked: count,
  matchedContacts: count,
  createdContacts: count,
  updatedContacts: count.nullable(),
  unchangedContacts: count.nullable(),
  conflicts: count.nullable(),
  evidenceWritten: count,
  quarantined: count,
  created: count,
  matched: count,
  blocked: count,
  failed: count,
  unknown: count,
});
export const contactImportOperation = z
  .strictObject({
    operationRef: contactImportRef,
    sourceRef: contactSourceRef,
    status: z.enum(["completed", "unknown"]),
    created: z.boolean(),
    submittedAt: instant,
    completedAt: instant.nullable(),
    contactImportBatchId: z.string().uuid(),
    counts: contactImportCounts,
  })
  .refine((value) => value.status !== "unknown" || value.completedAt === null);

export type ConnectionChoice = z.infer<typeof connectionChoice>;
export type Connection = z.infer<typeof connection>;
export type ConnectionAuthorization = z.infer<typeof connectionAuthorization>;
export type ContactSource = z.infer<typeof contactSource>;
export type ContactSources = z.infer<typeof contactSources>;
export type ContactSourcePreview = z.infer<typeof contactSourcePreview>;
export type ContactImportOperation = z.infer<typeof contactImportOperation>;
