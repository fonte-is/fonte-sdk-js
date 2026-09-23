import {
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";
import type {
  CampaignCommandEnvelope,
  CampaignConfigurationWire,
  CampaignEnvironment,
  CampaignListEnvelope,
  CampaignReadEnvelope,
} from "./operator-campaign-types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface CampaignEnvelopeScope {
  readonly tenantId: string;
  readonly environment: CampaignEnvironment;
}

export function parseCampaignList(
  value: unknown,
  scope: CampaignEnvelopeScope,
): CampaignListEnvelope {
  return parseCoreReceipt((input) => {
    const envelope = exactObject(input, [
      "schemaVersion",
      "tenantId",
      "environment",
      "configurations",
      "nextCursor",
    ]);
    baseScope(envelope, scope);
    if (
      !Array.isArray(envelope.configurations) ||
      envelope.configurations.length > 50
    ) {
      invalid();
    }
    envelope.configurations.forEach((item) =>
      campaignConfiguration(item, scope),
    );
    nullableCursor(envelope.nextCursor);
    return input as CampaignListEnvelope;
  }, value);
}

export function parseCampaignRead(
  value: unknown,
  scope: CampaignEnvelopeScope,
  campaignId: string,
): CampaignReadEnvelope {
  uuid(campaignId);
  return parseCoreReceipt((input) => {
    const envelope = exactObject(input, [
      "schemaVersion",
      "tenantId",
      "environment",
      "configuration",
    ]);
    baseScope(envelope, scope);
    const configuration = campaignConfiguration(envelope.configuration, scope);
    if (configuration.campaignId !== campaignId) invalid();
    return input as CampaignReadEnvelope;
  }, value);
}

export function parseCampaignCommand(
  value: unknown,
  scope: CampaignEnvelopeScope,
  operationId: string,
  campaignId?: string,
  commandKind?: "create" | "update",
): CampaignCommandEnvelope {
  uuid(operationId);
  if (campaignId !== undefined) uuid(campaignId);
  return parseCoreReceipt(
    (input) => {
      const envelope = exactObject(input, [
        "schemaVersion",
        "tenantId",
        "environment",
        "configuration",
        "receipt",
        "replayed",
      ]);
      baseScope(envelope, scope);
      if (typeof envelope.replayed !== "boolean") invalid();
      const configuration = campaignConfiguration(
        envelope.configuration,
        scope,
      );
      const receipt = exactObject(envelope.receipt, [
        "operationId",
        "commandKind",
        "campaignId",
        "resultingRevision",
        "committedAt",
      ]);
      if (
        receipt.operationId !== operationId ||
        !UUID.test(String(receipt.campaignId)) ||
        receipt.campaignId !== configuration.campaignId ||
        receipt.resultingRevision !== configuration.revision ||
        (campaignId !== undefined && configuration.campaignId !== campaignId) ||
        (receipt.commandKind !== "create" &&
          receipt.commandKind !== "update") ||
        (commandKind !== undefined && receipt.commandKind !== commandKind)
      ) {
        invalid();
      }
      instant(receipt.committedAt);
      return input as CampaignCommandEnvelope;
    },
    value,
    "unknown",
  );
}

export function validateCampaignPageInput(input: {
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeArchived?: boolean;
}): void {
  if (
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 50)) ||
    (input.cursor !== undefined &&
      (!input.cursor || Buffer.byteLength(input.cursor, "utf8") > 2_048)) ||
    (input.includeArchived !== undefined &&
      typeof input.includeArchived !== "boolean")
  ) {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
}

export function validateCampaignFields(
  input: {
    readonly campaignId: string;
    readonly operationId?: string;
    readonly expectedRevision?: number;
    readonly title?: string;
    readonly description?: string;
    readonly archived?: boolean;
  },
  mutation: "create" | "update" | "read",
): void {
  try {
    uuid(input.campaignId);
    if (mutation === "create" || mutation === "update") {
      uuid(input.operationId);
      if (input.title === undefined) invalid();
    }
    if (
      mutation === "update" &&
      (!Number.isSafeInteger(input.expectedRevision) ||
        (input.expectedRevision ?? 0) < 1)
    )
      invalid();
    if (input.title !== undefined) title(input.title);
    if (input.description !== undefined) description(input.description);
    if (
      mutation === "update" &&
      (typeof input.archived !== "boolean" || input.description === undefined)
    )
      invalid();
  } catch {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
}

export function assertCampaignBodyBytes(body: Record<string, unknown>): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(body);
  } catch {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
  if (
    encoded === undefined ||
    Buffer.byteLength(encoded, "utf8") > 16 * 1_024
  ) {
    throw new CoreOperatorError("core_request_invalid", null, "none");
  }
}

function baseScope(
  envelope: Record<string, unknown>,
  scope: CampaignEnvelopeScope,
): void {
  if (
    envelope.schemaVersion !== "campaign_configuration.v1" ||
    envelope.tenantId !== scope.tenantId ||
    envelope.environment !== scope.environment
  ) {
    invalid();
  }
}

function campaignConfiguration(
  value: unknown,
  scope: CampaignEnvelopeScope,
): CampaignConfigurationWire {
  const body = exactObject(value, [
    "workspaceId",
    "environment",
    "campaignId",
    "revision",
    "title",
    "description",
    "archived",
    "createdAt",
    "updatedAt",
    "scopeBindingStatus",
  ]);
  if (
    body.workspaceId !== scope.tenantId ||
    body.environment !== scope.environment ||
    body.scopeBindingStatus !== "not_qualified"
  ) {
    invalid();
  }
  uuid(body.campaignId);
  positiveRevision(body.revision);
  boundedTitle(body.title);
  boundedDescription(body.description);
  boolean(body.archived);
  instant(body.createdAt);
  instant(body.updatedAt);
  return body as unknown as CampaignConfigurationWire;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const body = object(value);
  const actual = Object.keys(body);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    invalid();
  return body;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
}

function positiveRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid();
}

function boundedTitle(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    Array.from(value).length < 1 ||
    Array.from(value).length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid();
}

function boundedDescription(value: unknown): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4_096)
    invalid();
}

function nullableCursor(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > 2_048
  )
    invalid();
  return value;
}

function title(value: string): void {
  boundedTitle(value);
}

function description(value: string): void {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4_096)
    invalid();
}

function boolean(value: unknown): asserts value is boolean {
  if (typeof value !== "boolean") invalid();
}

function instant(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 50) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value)
    invalid();
}

function invalid(): never {
  throw new TypeError("invalid campaign metadata envelope");
}
