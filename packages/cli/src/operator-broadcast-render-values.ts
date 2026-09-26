import { CoreOperatorError } from "./operator-core-request.js";
import type {
  BroadcastRenderProof,
  BroadcastTestResult,
} from "./operator-broadcast-render-test-types.js";

export function renderProof(value: unknown): BroadcastRenderProof {
  const body = record(value);
  const source = body.source;
  const templateIdentity = body.templateIdentity;
  if (source !== "composer" && source !== "html") {
    throw new TypeError("render proof authority invalid");
  }
  const expectedTemplateIdentity = source === "composer"
    ? "workspace_broadcast_v1"
    : "complete_html_v1";
  if (
    templateIdentity !== expectedTemplateIdentity
    || body.textSource !== "draft"
  ) throw new TypeError("render proof authority invalid");
  return {
    source,
    template_identity: expectedTemplateIdentity,
    template_revision: text(body.templateRevision),
    broadcast_version: positiveInteger(body.broadcastVersion),
    renderer_version: text(body.rendererVersion),
    recipient_slot_schema_version: text(body.recipientSlotSchemaVersion),
    finalizer_version: text(body.finalizerVersion),
    text_source: "draft",
    render_hash: renderDigest(body.renderHash),
  };
}

export function requireProofInput(
  proof: BroadcastRenderProof,
  revision: number,
): void {
  if (
    proof.broadcast_version !== revision
    || !/^sha256:[0-9a-f]{64}$/.test(proof.render_hash)
    || (proof.source === "composer"
      ? proof.template_identity !== "workspace_broadcast_v1"
      : proof.template_identity !== "complete_html_v1")
    || proof.text_source !== "draft"
  ) {
    throw new CoreOperatorError("broadcast_render_identity_invalid", null, "none");
  }
}

export function sameProof(
  left: BroadcastRenderProof,
  right: BroadcastRenderProof,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function productionBody(value: unknown): Record<string, unknown> {
  const body = record(value);
  if (body.environment !== "production") {
    throw new TypeError("production receipt required");
  }
  return body;
}

export function providerSubmissionStatus(
  value: unknown,
): BroadcastTestResult["provider_submission_status"] {
  if (
    value === "processing" || value === "accepted"
    || value === "partially_accepted" || value === "refused"
    || value === "unknown" || value === "not_submitted"
  ) return value;
  throw new TypeError("provider submission status invalid");
}

export function testStatus(value: unknown): BroadcastTestResult["status"] {
  if (value === "processing" || value === "unknown" || value === "terminal") {
    return value;
  }
  throw new TypeError("test status invalid");
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("object required");
  }
  return value as Record<string, unknown>;
}

export function content(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 524_288) {
    throw new TypeError("render content invalid");
  }
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) {
    throw new TypeError("text invalid");
  }
  return value;
}

export function nullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2_000) {
    throw new TypeError("nullable text invalid");
  }
  return value;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("boolean required");
  return value;
}

export function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("count invalid");
  }
  return value as number;
}

export function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}

export function positiveInteger(value: unknown): number {
  const result = count(value);
  if (result < 1) throw new TypeError("positive integer required");
  return result;
}

export function uuid(value: unknown): string {
  const result = text(value);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) {
    throw new TypeError("UUID required");
  }
  return result.toLowerCase();
}

export function renderDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError("render digest invalid");
  }
  return value;
}

export function absoluteHttpsUrl(value: unknown): string {
  const result = text(value);
  const url = new URL(result);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("safe HTTPS URL required");
  }
  return result;
}
