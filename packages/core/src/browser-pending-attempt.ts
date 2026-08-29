import { clean } from "./collect-contract.js";
import type { CollectionPostureObservation } from "./collection-posture.js";
import type { CaptureEventType } from "./browser-types.js";
import type { Scope } from "./types.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingAttempt {
  eventId: string;
  occurredAt: string;
}

export const parsePendingAttempt = (value: string): PendingAttempt | null => {
  if (!value.startsWith("pending:")) return null;
  try {
    const parsed = JSON.parse(value.slice("pending:".length)) as Record<
      string,
      unknown
    >;
    if (
      Object.keys(parsed).length !== 2 ||
      !uuidPattern.test(clean(parsed.eventId, 80)) ||
      typeof parsed.occurredAt !== "string" ||
      new Date(parsed.occurredAt).toISOString() !== parsed.occurredAt
    )
      return null;
    return {
      eventId: clean(parsed.eventId, 80).toLowerCase(),
      occurredAt: parsed.occurredAt,
    };
  } catch {
    return null;
  }
};

export async function pendingAttemptKey(
  installationNamespace: string,
  observation: CollectionPostureObservation,
  eventType: CaptureEventType,
  scope: Scope,
): Promise<string> {
  const currentUrl = new URL(scope.current_url);
  const identity = JSON.stringify([
    installationNamespace,
    currentUrl.origin,
    currentUrl.href,
    observation.policyVersion,
    observation.visitorChoice,
    eventType,
  ]);
  if (!globalThis.crypto?.subtle) {
    throw new Error("fonte_crypto_digest_unavailable");
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identity),
    ),
  );
  const encoded = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // This non-secret digest is namespacing, not authorization.
  return `${installationNamespace}:pending-v2:${encoded}`;
}
