import { createBrowserReturnDelivery } from "./application-delivery.js";
import {
  nativeId,
  nativeInstant,
  nativeObject,
  nativeUuid,
  normalizeNativeRecord,
} from "./results-types.js";
import type {
  FonteBrowserIdentity,
  FonteReturnOptions,
  IdentityRecord,
  ReturnRecord,
} from "./results-types.js";

export type {
  FonteBrowserIdentity,
  FonteReturnOptions,
} from "./results-types.js";

function decodeClaims(token: string): unknown {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    throw 0;
  const encoded = token.split(".")[0]!;
  const decoded = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  if (
    btoa(decoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !==
    encoded
  )
    throw 0;
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
    ),
  );
}

/** Attempt one visible Return. True means best-effort delivery was started, never a durable ACK. */
export function recordFonteReturn(
  identity: FonteBrowserIdentity,
  options: FonteReturnOptions = {},
): boolean {
  try {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible" ||
      document.hidden === true
    )
      return false;
    const o = nativeObject(
      options,
      ["apiOrigin", "fetch", "now", "allowInsecureLocalhost"],
      [],
    );
    const b = nativeObject(identity, [
      "installationId",
      "identityToken",
      "userId",
      "identityEventId",
      "validUntil",
    ]);
    const installationId = nativeId(b.installationId),
      userId = nativeId(b.userId),
      identityEventId = nativeUuid(b.identityEventId),
      validUntil = nativeInstant(b.validUntil);
    if (typeof b.identityToken !== "string") return false;
    const claims = nativeObject(decodeClaims(b.identityToken), [
      "schema",
      "installationId",
      "identity",
      "measurementAllowed",
    ]);
    if (
      claims.schema !== "fonte.identity.v1" ||
      claims.installationId !== installationId ||
      claims.measurementAllowed !== true
    )
      return false;
    const delivery = createBrowserReturnDelivery(
      {
        ...(o as FonteReturnOptions),
        sourceId: installationId,
        identityToken: b.identityToken,
      },
      normalizeNativeRecord,
    );
    const now = delivery.clock();
    const admitted = normalizeNativeRecord(claims.identity, now);
    if (admitted.kind !== "identify") {
      delivery.close();
      return false;
    }
    const record: IdentityRecord = admitted;
    if (
      record.user.id !== userId ||
      record.eventId !== identityEventId ||
      record.validUntil !== validUntil ||
      now < Date.parse(record.occurredAt) ||
      now >= Date.parse(validUntil)
    ) {
      delivery.close();
      return false;
    }
    const returned: ReturnRecord = {
      kind: "return",
      eventId: globalThis.crypto.randomUUID(),
      occurredAt: new Date(now).toISOString(),
      userId,
      identityEventId,
      foreground: true,
    };
    if (!delivery.enqueue(returned, true)) {
      delivery.close();
      return false;
    }
    void delivery.flush().finally(() => {
      delivery.close();
    });
    return true;
  } catch {
    return false;
  }
}
