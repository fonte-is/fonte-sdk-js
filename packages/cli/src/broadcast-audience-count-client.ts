import { z } from "zod";
import { createCoreRequester, CoreOperatorError, parseCoreReceipt, type CoreRequester } from "./operator-core-request.js";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform(value => value.toLowerCase());
const reference = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("everyone") }),
  z.strictObject({ kind: z.literal("system"), systemId: uuid }),
  z.strictObject({ kind: z.literal("one_time"), oneTimeSetId: uuid }),
  z.strictObject({ kind: z.literal("contact"), contactId: z.string().min(1).max(200).refine(value => value === value.trim() && !/\p{Cc}/u.test(value)) }),
  z.strictObject({ kind: z.literal("email_domain"), domain: z.string().refine(value => {
    if (!/^[\x00-\x7f]*$/.test(value) || /\p{Cc}/u.test(value)) return false;
    const domain = value.trim().toLowerCase();
    return domain.length <= 253 && domain.includes(".")
      && domain.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
  }).transform(value => value.trim().toLowerCase()) }),
  z.strictObject({ kind: z.literal("collection"), collectionId: uuid }),
  z.strictObject({ kind: z.literal("import_batch"), contactImportBatchId: uuid }),
]);
export type AudienceCountReferenceV1 = z.output<typeof reference>;
const expression = z.strictObject({ include: z.array(reference).max(100), exclude: z.array(reference).max(100).default([]) })
  .superRefine((value, context) => {
    const include = value.include.map(referenceKey);
    const exclude = value.exclude.map(referenceKey);
    if (new Set(include).size !== include.length || new Set(exclude).size !== exclude.length
      || exclude.some(key => include.includes(key)) || value.include.some(item => item.kind === "email_domain")
      || value.exclude.some(item => item.kind === "everyone")
      || (value.include.some(item => item.kind === "everyone") && value.include.length !== 1)) {
      context.addIssue({ code: "custom", message: "Invalid recipient expression" });
    }
  });
export const audienceCountRequestSchemaV1 = z.strictObject({
  schema: z.literal("audience_count_request.v1"), requestId: uuid,
  recipientExpression: expression, communicationPurposeId: uuid.nullable(), sourceCampaignId: uuid.nullable(),
  minimumDraftExclusionActionId: uuid.optional(),
}).superRefine((value, context) => {
  if (Object.hasOwn(value, "minimumDraftExclusionActionId") && value.minimumDraftExclusionActionId === undefined)
    context.addIssue({ code: "custom", message: "Invalid minimumDraftExclusionActionId" });
});
export type AudienceCountRequestV1 = z.output<typeof audienceCountRequestSchemaV1>;
export const audienceCountInputSchema = z.strictObject({ workspace: z.string().min(2).max(63).regex(/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/),
  draftId: uuid, request: audienceCountRequestSchemaV1 });
export type AudienceCountInput = z.output<typeof audienceCountInputSchema>;
export const audienceCountResultSchemaV1 = z.strictObject({ schema: z.literal("audience_count_result.v1"), requestId: uuid,
  workspaceId: uuid, environment: z.enum(["sandbox", "production"]), draftId: uuid,
  selectionDigest: z.string().regex(/^[0-9a-f]{64}$/),
  sourceRevision: z.string().min(1).max(256).refine(value => !/\p{Cc}/u.test(value)),
  observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/).refine(value => Number.isFinite(Date.parse(value))),
  recipientCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type AudienceCountResultV1 = z.output<typeof audienceCountResultSchemaV1>;
export const audienceCountErrorSchemaV1 = z.strictObject({ schema: z.literal("audience_count_error.v1"),
  requestId: uuid.optional(), code: z.enum(["audience_count_invalid_request", "audience_targeting_incomplete", "audience_source_unavailable",
    "audience_count_unavailable", "audience_count_capacity_exceeded", "audience_count_timeout"]) });
export type AudienceCountErrorV1 = z.output<typeof audienceCountErrorSchemaV1>;

export interface AudienceCountRequesterOptions {
  readonly environment: "sandbox" | "production";
  readonly resolveWorkspaceId: (workspace: string, timeoutMs: number) => Promise<string>;
  readonly coreApiBaseUrl?: string;
  readonly bearer?: string;
  readonly fetch?: typeof fetch;
  readonly request?: CoreRequester;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export async function countBroadcastAudience(input: AudienceCountInput, options: AudienceCountRequesterOptions): Promise<AudienceCountResultV1> {
  let checked: AudienceCountInput;
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).length > 64 * 1024) throw new TypeError("request size");
    checked = audienceCountInputSchema.parse(input);
  } catch {
    throw new CoreOperatorError("audience_count_invalid_request", 400, "none");
  }
  if (checked.request.recipientExpression.include.length === 0) throw new CoreOperatorError("audience_targeting_incomplete", 422, "none");
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new CoreOperatorError("core_request_timeout_invalid", null, "none");
  const requester = options.request ?? standaloneRequester(options, timeoutMs);
  const workspaceId = uuid.parse(await options.resolveWorkspaceId(checked.workspace, timeoutMs));
  const environment = z.enum(["sandbox", "production"]).parse(options.environment);
  const expectedDigest = await audienceCountSelectionDigestV1(workspaceId, environment, checked.draftId, checked.request);
  const path = `/v1/workspaces/${encodeURIComponent(checked.workspace)}/broadcast-drafts/${encodeURIComponent(checked.draftId)}/audience-count?environment=${environment}`;
  let response: unknown;
  try {
    response = await requester(path, { body: checked.request as unknown as Record<string, unknown>, lostResponseEffect: "none", timeoutMs });
  } catch (error) {
    if (error instanceof CoreOperatorError && error.statusCode !== null
      && error.reason === `core_request_failed_${error.statusCode}`) {
      const code = COUNT_FAILURE_BY_STATUS[error.statusCode];
      if (code) throw new CoreOperatorError(code, error.statusCode, "none");
    }
    throw error;
  }
  const result = parseCoreReceipt(value => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 8 * 1024) throw new TypeError("result size");
    return audienceCountResultSchemaV1.parse(value);
  }, response, "none");
  if (result.requestId !== checked.request.requestId || result.workspaceId !== workspaceId || result.environment !== environment
    || result.draftId !== checked.draftId || result.selectionDigest !== expectedDigest)
    throw new CoreOperatorError("core_operator_receipt_invalid", null, "none");
  return result;
}

const COUNT_FAILURE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "audience_count_invalid_request", 422: "audience_targeting_incomplete", 404: "audience_source_unavailable",
  503: "audience_count_unavailable", 429: "audience_count_capacity_exceeded", 504: "audience_count_timeout",
};

function standaloneRequester(options: AudienceCountRequesterOptions, timeoutMs: number): CoreRequester {
  if (!options.coreApiBaseUrl || !options.bearer || !options.fetch)
    throw new CoreOperatorError("broadcast_authenticated_requester_missing", null, "none");
  return createCoreRequester({ coreApiBaseUrl: options.coreApiBaseUrl, bearer: options.bearer, fetch: options.fetch,
    signal: options.signal, timeoutMs, maxResponseBytes: 8 * 1024 });
}

export async function audienceCountSelectionDigestV1(workspaceId: string, environment: "sandbox" | "production", draftId: string,
  request: AudienceCountRequestV1): Promise<string> {
  const checked = audienceCountRequestSchemaV1.parse(request);
  if (checked.recipientExpression.include.length === 0)
    throw new CoreOperatorError("audience_targeting_incomplete", 422, "none");
  const canonical = { schema: "audience_count_selection.v1", workspaceId: uuid.parse(workspaceId), environment, draftId: uuid.parse(draftId),
    communicationPurposeId: checked.communicationPurposeId, sourceCampaignId: checked.sourceCampaignId,
    include: sorted(checked.recipientExpression.include), exclude: sorted(checked.recipientExpression.exclude) };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
function sorted(items: readonly AudienceCountReferenceV1[]): AudienceCountReferenceV1[] {
  return [...items].sort((left, right) => referenceKey(left) < referenceKey(right) ? -1 : referenceKey(left) > referenceKey(right) ? 1 : 0);
}
function referenceKey(value: AudienceCountReferenceV1): string {
  switch (value.kind) {
    case "everyone": return "everyone";
    case "system": return `system:${value.systemId}`;
    case "one_time": return `one_time:${value.oneTimeSetId}`;
    case "contact": return `contact:${value.contactId}`;
    case "email_domain": return `email_domain:${value.domain}`;
    case "collection": return `collection:${value.collectionId}`;
    case "import_batch": return `import_batch:${value.contactImportBatchId}`;
  }
}
