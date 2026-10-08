import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { nativeObject, normalizeNativeRecord } from "./results-types.js";
import type {
  FontePostHogCapture,
  FontePostHogTriggerOptions,
  IdentityRecord,
} from "./results-types.js";

/** Same installation verifier and native record grammar; no new key or provider client. */
export function postHogCapture(
  installationId: string,
  signingKey: Uint8Array,
  identity: IdentityRecord,
  key: string,
  options: FontePostHogTriggerOptions,
  now: number,
  sourceRevision: number,
): FontePostHogCapture {
  const v = nativeObject(options, [
    "projectId", "event", "sourceRevision", "eventId", "occurredAt",
  ], ["projectId", "event", "eventId", "occurredAt"]);
  if (typeof v.projectId !== "string" || !/^[1-9][0-9]{0,18}$/.test(v.projectId)
    || typeof v.event !== "string" || !v.event.length || v.event.length > 120
    || v.event.trim() !== v.event || /[\u0000-\u001f\u007f]/.test(v.event)
    || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1
    || Object.hasOwn(v, "sourceRevision") && v.sourceRevision !== sourceRevision) throw 0;
  const record = normalizeNativeRecord({
    kind: "trigger", eventId: v.eventId, occurredAt: v.occurredAt,
    userId: identity.user.id, identityEventId: identity.eventId,
    trigger: key, successful: true,
  }, now);
  const at = Date.parse(record.occurredAt);
  if (at < Date.parse(identity.occurredAt) || at >= Date.parse(identity.validUntil)) throw 0;
  const encoded = Buffer.from(JSON.stringify({
    schema: "fonte.posthog.commit.v1", sourceId: installationId,
    sourceRevision, projectId: v.projectId, event: v.event, record,
  }), "utf8").toString("base64url");
  const proof = `${encoded}.${createHmac("sha256", signingKey).update(encoded, "utf8").digest("base64url")}`;
  if (Buffer.byteLength(proof, "utf8") > 4096) throw 0;
  return Object.freeze({
    event: v.event, uuid: record.eventId, distinctId: identity.user.id,
    timestamp: new Date(at), properties: Object.freeze({ fonte_commit: proof }),
  });
}
