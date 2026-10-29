import "server-only";
import {
  createFonteApplicationSource,
  type FonteApplicationSource,
} from "@fonte-is/nextjs/application";

let attempted = false;
let source: FonteApplicationSource | null = null;

/** Server process singleton extending the already installed Website. */
export function getFonteApplicationSource(): FonteApplicationSource | null {
  if (attempted) return source;
  attempted = true;
  const siteId = process.env.FONTE_SITE_ID;
  const sourceId = process.env.FONTE_APPLICATION_SOURCE_ID;
  const serverKey = process.env.FONTE_APPLICATION_SERVER_KEY;
  const origin = process.env.FONTE_APPLICATION_ORIGIN;
  const policyVersion = process.env.FONTE_APPLICATION_POLICY_VERSION;
  if (!siteId || !sourceId || !serverKey || !origin || !policyVersion)
    return null;
  try {
    source = createFonteApplicationSource({
      siteId,
      sourceId,
      serverKey,
      origin,
      policyVersion,
      ...(process.env.FONTE_API_ORIGIN
        ? { apiOrigin: process.env.FONTE_API_ORIGIN }
        : {}),
    });
  } catch {
    // An absent or invalid measurement configuration cannot break user operations.
    // Never include the configuration or original exception in a log/response.
    source = null;
  }
  return source;
}

/** Optional graceful-shutdown work; never await this in a business handler. */
export async function drainApplicationObservations() {
  return source ? source.flush() : null;
}

/** Only after the host has stopped admitting new work and attempted its drain. */
export function closeApplicationObservations() {
  return source ? source.close() : null;
}
