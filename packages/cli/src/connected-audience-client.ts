import { z } from "zod";
import { contactSourceRef } from "./connection-contracts.js";
import {
  CoreOperatorError,
  type CoreRequester,
} from "./operator-core-request.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const scope = z.strictObject({
  workspace: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/)
    .refine((value) => !value.includes("--")),
  environment: z.enum(["sandbox", "production"]),
});
export const audienceSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("connected_source"),
    sourceRef: contactSourceRef,
  }),
  z.strictObject({
    kind: z.literal("fonte_audience"),
    contactImportBatchId: uuid,
    identitySetSha256: sha256,
  }),
]);
export const reconcileAudienceSchema = scope.extend({
  source: audienceSourceSchema,
  exclusionSourceRefs: z
    .array(contactSourceRef)
    .max(24)
    .refine((values) => new Set(values).size === values.length),
});
export const freezeAudienceSchema = reconcileAudienceSchema.extend({
  expectedObservationFingerprint: sha256,
  idempotencyKey: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[^\p{Cc}]+$/u)
    .refine((value) => value.trim() === value),
  declaredPermissionBasis: z
    .enum(["evidence_only", "permission_basis_marketing_claimed"])
    .optional(),
});
const counts = z.strictObject({
  source: count,
  exclusionUnion: count,
  protected: count,
  unknown: count,
  final: count,
});
const reconciliation = z
  .strictObject({
    ready: z.boolean(),
    observationFingerprint: sha256.nullable(),
    counts: counts.nullable(),
    exclusions: z.array(
      z.strictObject({
        sourceRef: contactSourceRef,
        overlapCount: count.nullable(),
      }),
    ),
    unavailableInputs: z.array(
      z.strictObject({
        role: z.enum(["source", "exclusion"]),
        sourceRef: contactSourceRef.nullable(),
        reason: z.string().regex(/^[a-z0-9_]{1,100}$/),
      }),
    ),
    contacts: z
      .array(
        z.strictObject({
          email: z.string().min(1).max(320),
          disposition: z.enum(["excluded", "protected", "unknown", "final"]),
          protectionReasons: z.array(z.string().min(1).max(100)),
          exclusionSourceRefs: z.array(contactSourceRef),
        }),
      )
      .nullable(),
  })
  .transform(({ contacts: _contacts, ...summary }) => summary);
const frozenAudience = z
  .strictObject({
    frozenAudienceId: uuid,
    contactImportBatchId: uuid,
    label: z.string().min(1).max(500),
    created: z.boolean(),
    observationFingerprint: sha256,
    counts,
    recipientExpression: z.strictObject({
      include: z.tuple([
        z.strictObject({
          kind: z.literal("import_batch"),
          contactImportBatchId: uuid,
        }),
      ]),
      exclude: z.tuple([]),
    }),
  })
  .refine(
    (value) =>
      value.recipientExpression.include[0].contactImportBatchId ===
      value.contactImportBatchId,
  );

export type AudienceSource = z.infer<typeof audienceSourceSchema>;
export type ReconcileAudienceInput = z.infer<typeof reconcileAudienceSchema>;
export type FreezeAudienceInput = z.infer<typeof freezeAudienceSchema>;
export type AudienceReconciliation = z.infer<typeof reconciliation>;
export type FrozenAudience = z.infer<typeof frozenAudience>;
export interface ConnectedAudienceClient {
  reconcileAudience(
    input: ReconcileAudienceInput,
  ): Promise<AudienceReconciliation>;
  freezeAudience(input: FreezeAudienceInput): Promise<FrozenAudience>;
}

export function createConnectedAudienceClient(
  request: CoreRequester,
): ConnectedAudienceClient {
  return {
    async reconcileAudience(input) {
      const parsed = parseInput(reconcileAudienceSchema, input);
      const { workspace, environment, ...body } = parsed;
      const result = parseReceipt(
        reconciliation,
        await request(path(workspace, environment, "reconcile"), {
          body,
          lostResponseEffect: "none",
        }),
        "none",
      );
      if (
        result.exclusions.length !== parsed.exclusionSourceRefs.length ||
        result.exclusions.some(
          (value, index) =>
            value.sourceRef !== parsed.exclusionSourceRefs[index],
        )
      )
        invalidReceipt("none");
      return result;
    },
    async freezeAudience(input) {
      const parsed = parseInput(freezeAudienceSchema, input);
      const { workspace, environment, ...body } = parsed;
      const result = parseReceipt(
        frozenAudience,
        await request(path(workspace, environment, "freeze"), {
          body,
          idempotencyKey: parsed.idempotencyKey,
          lostResponseEffect: "unknown",
        }),
        "unknown",
      );
      if (
        result.observationFingerprint !== parsed.expectedObservationFingerprint
      )
        invalidReceipt("unknown");
      return result;
    },
  };
}
function path(
  workspace: string,
  environment: string,
  operation: string,
): string {
  return `/v1/workspaces/${encodeURIComponent(workspace)}/connected-audience/${operation}?environment=${environment}`;
}
function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new CoreOperatorError("audience_request_invalid", null, "none");
  return result.data;
}
function parseReceipt<T extends z.ZodType>(
  schema: T,
  value: unknown,
  effect: "none" | "unknown",
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) invalidReceipt(effect);
  return result.data;
}
function invalidReceipt(effect: "none" | "unknown"): never {
  throw new CoreOperatorError("core_operator_receipt_invalid", null, effect);
}
