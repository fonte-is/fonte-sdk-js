import { z } from "zod";

// Transport validation only. All language, values and diagnostics come from Core.
const scalarType = z.enum(["string", "number", "boolean", "date", "datetime"]);
const span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict();
export const personalizationDiagnosticSchema = z.object({
  code: z.string().min(1), severity: z.enum(["warning", "error"]),
  location: z.string().min(1), span, token: z.string(), path: z.string().optional(),
  message: z.string(), correction: z.string().optional(),
}).passthrough();
export const personalizationSchema = z.object({
  schemaVersion: z.string().min(1), templateRevision: z.string().min(1),
  rendererVersion: z.string().min(1), finalizerVersion: z.string().min(1),
  builtIns: z.array(z.object({ path: z.string(), type: scalarType, nullable: z.boolean() }).passthrough()),
  customFields: z.array(z.object({ key: z.string(), path: z.string(), label: z.string(),
    type: scalarType, nullable: z.boolean(), state: z.string(), available: z.boolean() }).passthrough()),
  publicScalarTypes: z.array(scalarType), customKeyPattern: z.string(),
  customFieldStates: z.array(z.string()), deletedStateTerminal: z.boolean(), inactiveStateSupported: z.boolean(),
  filters: z.array(z.string()), locations: z.array(z.string()), htmlLocation: z.string(),
  unsupportedLocations: z.array(z.string()), grammar: z.record(z.string(), z.unknown()),
  diagnostics: z.array(z.object({ code: z.string(), severity: z.enum(["warning", "error"]),
    blocking: z.boolean() }).passthrough()), sourceSpans: z.record(z.string(), z.string()),
  historicalCompatibility: z.string(),
}).passthrough();
export const personalizationSampleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("synthetic_missing") }).strict(),
  z.object({ kind: z.literal("selected_contact"), contactId: z.string().min(1).max(320),
    recipientEmail: z.string().min(1).max(320) }).strict(),
]);
export const personalizationManifestSchema = z.object({
  schemaVersion: z.string(),
  fields: z.array(z.object({ path: z.string(), type: scalarType, nullable: z.boolean() }).passthrough()),
  references: z.array(z.object({ path: z.string(), fallback: z.string().nullable(),
    token: z.string(), location: z.string(), span }).passthrough()),
}).passthrough();
export const broadcastPersonalizationSchemaResultSchema = z.object({
  kind: z.literal("broadcast_personalization_schema"), tenantId: z.string(),
  environment: z.enum(["sandbox", "production"]), schema: personalizationSchema, effect: z.literal("none"),
}).passthrough();
const previewEnvelope = {
  kind: z.literal("broadcast_personalization_preview"), tenantId: z.string(),
  environment: z.enum(["sandbox", "production"]), broadcastDraftId: z.string().uuid(),
  draftVersion: z.number().int().positive(), schema: personalizationSchema,
  manifest: personalizationManifestSchema, diagnostics: z.array(personalizationDiagnosticSchema),
  sample: personalizationSampleSchema, effect: z.literal("none"),
};
export const broadcastPersonalizationPreviewResultSchema = z.discriminatedUnion("status", [
  z.object({ ...previewEnvelope, status: z.literal("invalid"), preview: z.null() }).passthrough(),
  z.object({ ...previewEnvelope, status: z.literal("valid"), preview: z.object({
    status: z.literal("preview"), broadcastDraftId: z.string().uuid(), environment: z.enum(["sandbox", "production"]),
    renderContentDigest: z.string(), html: z.string(), text: z.string(),
    renderProof: z.object({ templateRevision: z.string(), rendererVersion: z.string(),
      recipientSlotSchemaVersion: z.string(), finalizerVersion: z.string(), broadcastVersion: z.number(),
      renderHash: z.string() }).passthrough(),
    sampleRender: z.object({ recipientEmail: z.string(), subject: z.string(), preheader: z.string().nullable(),
      html: z.string(), text: z.string(), finalizerVersion: z.string(),
      diagnostics: z.array(personalizationDiagnosticSchema), valueSource: z.union([
        z.object({ kind: z.literal("synthetic_missing") }).strict(),
        z.object({ kind: z.literal("selected_contact"), contactId: z.string() }).strict(),
      ]) }).passthrough(),
  }).passthrough() }).passthrough(),
]);
export type BroadcastPersonalizationSchemaResult = z.infer<typeof broadcastPersonalizationSchemaResultSchema>;
export type BroadcastPersonalizationPreviewResult = z.infer<typeof broadcastPersonalizationPreviewResultSchema>;
export type BroadcastPersonalizationSample = z.infer<typeof personalizationSampleSchema>;
export interface BroadcastPersonalizationSchemaInput {
  readonly workspace: string;
  readonly environment?: "sandbox" | "production";
}
export interface BroadcastPersonalizationPreviewInput extends BroadcastPersonalizationSchemaInput {
  readonly draftId: string;
  readonly revision: number;
  readonly schemaVersion: string;
  readonly sample: BroadcastPersonalizationSample;
}
export type BroadcastPersonalizationCommand =
  | ({ readonly kind: "broadcast_personalization_schema" } & BroadcastPersonalizationSchemaInput)
  | ({ readonly kind: "broadcast_personalization_preview" } & BroadcastPersonalizationPreviewInput);
