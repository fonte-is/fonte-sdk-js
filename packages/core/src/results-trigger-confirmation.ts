import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { nativeObject, normalizeNativeRecord } from "./results-types.js";
import type {
  FonteTriggerConfirmationOptions,
  IdentityRecord,
} from "./results-types.js";

/** Confirms one original successful operation using the existing installation verifier. */
export function triggerConfirmation(
  installationId: string,
  signingKey: Uint8Array,
  identity: IdentityRecord,
  key: string,
  options: FonteTriggerConfirmationOptions,
  now: number,
  sourceRevision: number,
): string {
  const v = nativeObject(
    options,
    ["sourceRevision", "eventId", "occurredAt"],
    ["eventId", "occurredAt"],
  );
  if (
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1 ||
    (Object.hasOwn(v, "sourceRevision") && v.sourceRevision !== sourceRevision)
  )
    throw 0;
  const record = normalizeNativeRecord(
    {
      kind: "trigger",
      eventId: v.eventId,
      occurredAt: v.occurredAt,
      userId: identity.user.id,
      identityEventId: identity.eventId,
      trigger: key,
      successful: true,
    },
    now,
  );
  const at = Date.parse(record.occurredAt);
  if (
    at < Date.parse(identity.occurredAt) ||
    at >= Date.parse(identity.validUntil)
  )
    throw 0;
  const encoded = Buffer.from(
    JSON.stringify({
      schema: "fonte.trigger.confirmation.v1",
      sourceId: installationId,
      sourceRevision,
      record,
    }),
    "utf8",
  ).toString("base64url");
  const confirmation = `${encoded}.${createHmac("sha256", signingKey).update(encoded, "utf8").digest("base64url")}`;
  if (Buffer.byteLength(confirmation, "utf8") > 4096) throw 0;
  return confirmation;
}
