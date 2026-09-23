import {
  CoreOperatorError,
  parseCoreReceipt,
} from "./operator-core-request.js";
import type {
  SegmentCommandEnvelope,
  SegmentEnvironment,
  SegmentJsonObject,
  SegmentListEnvelope,
  SegmentListItemWire,
  SegmentReadEnvelope,
  SegmentRevisionWire,
} from "./operator-segment-types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
export const SEGMENT_RULE_MAX_BYTES = 64 * 1_024;
export const SEGMENT_COMMAND_MAX_BYTES = 96 * 1_024;

export interface SegmentEnvelopeScope {
  readonly tenantId: string;
  readonly environment: SegmentEnvironment;
}

export function parseSegmentList(
  value: unknown,
  scope: SegmentEnvelopeScope,
): SegmentListEnvelope {
  return parseCoreReceipt((input) => {
    const envelope = exactObject(input, [
      "schemaVersion",
      "tenantId",
      "environment",
      "segments",
      "nextCursor",
    ]);
    baseScope(envelope, scope);
    if (!Array.isArray(envelope.segments) || envelope.segments.length > 50)
      invalid();
    envelope.segments.forEach(segmentListItem);
    nullableCursor(envelope.nextCursor);
    return input as SegmentListEnvelope;
  }, value);
}

export function parseSegmentRead(
  value: unknown,
  scope: SegmentEnvelopeScope,
  segmentId: string,
  revision?: number,
): SegmentReadEnvelope {
  uuid(segmentId);
  return parseCoreReceipt((input) => {
    const envelope = exactObject(input, [
      "schemaVersion",
      "tenantId",
      "environment",
      "segment",
    ]);
    baseScope(envelope, scope);
    const segment = segmentRevision(envelope.segment, segmentId);
    if (revision !== undefined && segment.revision !== revision) invalid();
    return input as SegmentReadEnvelope;
  }, value);
}

export function parseSegmentCommand(
  value: unknown,
  scope: SegmentEnvelopeScope,
  operationId: string,
  segmentId?: string,
  commandKind?: "create" | "update" | "setArchived",
): SegmentCommandEnvelope {
  uuid(operationId);
  if (segmentId !== undefined) uuid(segmentId);
  return parseCoreReceipt(
    (input) => {
      const envelope = exactObject(input, [
        "schemaVersion",
        "tenantId",
        "environment",
        "segment",
        "receipt",
        "replayed",
      ]);
      baseScope(envelope, scope);
      if (typeof envelope.replayed !== "boolean") invalid();
      const segment = segmentRevision(envelope.segment, segmentId);
      const receipt = exactObject(envelope.receipt, [
        "operationId",
        "commandKind",
        "segmentId",
        "resultingRevision",
        "committedAt",
      ]);
      if (
        receipt.operationId !== operationId ||
        receipt.segmentId !== segment.segmentId ||
        receipt.resultingRevision !== segment.revision ||
        (receipt.commandKind !== "create" &&
          receipt.commandKind !== "update" &&
          receipt.commandKind !== "setArchived") ||
        (commandKind !== undefined && receipt.commandKind !== commandKind)
      )
        invalid();
      instant(receipt.committedAt);
      return input as SegmentCommandEnvelope;
    },
    value,
    "unknown",
  );
}

export function validateSegmentPageInput(input: {
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
  )
    invalidRequest();
}

export function validateSegmentFields(
  input: {
    readonly segmentId: string;
    readonly operationId?: string;
    readonly expectedRevision?: number;
    readonly title?: string;
    readonly rule?: SegmentJsonObject;
    readonly archived?: boolean;
  },
  mutation: "create" | "update" | "archive" | "read",
): void {
  try {
    uuid(input.segmentId);
    if (mutation !== "read") uuid(input.operationId);
    if (
      (mutation === "update" || mutation === "archive") &&
      (!Number.isSafeInteger(input.expectedRevision) ||
        (input.expectedRevision ?? 0) < 1)
    )
      invalid();
    if (
      (mutation === "create" || mutation === "update") &&
      (input.title === undefined || input.rule === undefined)
    )
      invalid();
    if (input.title !== undefined) boundedTitle(input.title);
    if (input.rule !== undefined) jsonObject(input.rule);
    if (mutation === "archive" && typeof input.archived !== "boolean")
      invalid();
  } catch {
    invalidRequest();
  }
}

export function assertSegmentBodyBytes(body: Record<string, unknown>): void {
  try {
    const encoded = JSON.stringify(body);
    if (
      encoded === undefined ||
      Buffer.byteLength(encoded, "utf8") > SEGMENT_COMMAND_MAX_BYTES
    ) {
      invalidRequest();
    }
  } catch {
    invalidRequest();
  }
}

export function assertSegmentRuleBytes(value: SegmentJsonObject): void {
  try {
    const encoded = JSON.stringify(jsonObject(value));
    if (
      encoded === undefined ||
      Buffer.byteLength(encoded, "utf8") > SEGMENT_RULE_MAX_BYTES
    ) {
      invalidRequest();
    }
  } catch {
    invalidRequest();
  }
}

function baseScope(
  envelope: Record<string, unknown>,
  scope: SegmentEnvelopeScope,
): void {
  if (
    envelope.schemaVersion !== "native_segment.v1" ||
    envelope.tenantId !== scope.tenantId ||
    envelope.environment !== scope.environment
  )
    invalid();
}

function segmentListItem(value: unknown): SegmentListItemWire {
  const item = exactObject(value, [
    "segmentId",
    "revision",
    "title",
    "archived",
    "createdAt",
    "updatedAt",
  ]);
  uuid(item.segmentId);
  positiveRevision(item.revision);
  boundedTitle(item.title);
  boolean(item.archived);
  instant(item.createdAt);
  instant(item.updatedAt);
  return item as unknown as SegmentListItemWire;
}

function segmentRevision(
  value: unknown,
  expectedId?: string,
): SegmentRevisionWire {
  const segment = exactObject(value, [
    "segmentId",
    "revision",
    "title",
    "rule",
    "ruleDigest",
    "semanticsVersion",
    "archived",
    "createdAt",
    "updatedAt",
  ]);
  uuid(segment.segmentId);
  if (expectedId !== undefined && segment.segmentId !== expectedId) invalid();
  positiveRevision(segment.revision);
  boundedTitle(segment.title);
  const rule = jsonObject(segment.rule);
  assertSegmentRuleBytes(rule);
  if (
    typeof segment.ruleDigest !== "string" ||
    !SHA256.test(segment.ruleDigest)
  )
    invalid();
  if (segment.semanticsVersion !== "native_rule.v1") invalid();
  boolean(segment.archived);
  instant(segment.createdAt);
  instant(segment.updatedAt);
  return segment as unknown as SegmentRevisionWire;
}

function jsonObject(value: unknown): SegmentJsonObject {
  const root = object(value);
  jsonValue(root);
  return root as SegmentJsonObject;
}

function jsonValue(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(jsonValue);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>))
      jsonValue(child);
    return;
  }
  invalid();
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
  throw new TypeError("invalid Segment metadata envelope");
}

function invalidRequest(): never {
  throw new CoreOperatorError("core_request_invalid", null, "none");
}
