import { diagnosticCode, FonteApiError } from "./server-errors.js";
import type { WriteResult } from "./types.js";

export type Environment = "sandbox" | "production";

export interface ClientConfig {
  baseUrl?: string;
  tenantId?: string;
  tenantApiKey: string;
  environment?: Environment;
  timeoutMs?: number;
  allowInsecureLocalhost?: boolean;
}

export interface TouchInput {
  idempotencyKey: string;
  occurredAt: string;
  source: string;
  /** Canonical browser Origin assertion. Required in production. */
  requestOrigin?: string;
  eventId?: string;
  event?: "page_view" | "source_touch";
  raw?: Record<string, unknown>;
  touch: {
    journeyId: string;
    platform: "meta" | "google" | "other";
    isPaid: boolean;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    fonteLinkToken?: string;
    channelType?:
      | "paid"
      | "owned"
      | "organic"
      | "partner"
      | "referral"
      | "direct"
      | "unknown";
    sourcePlatform?: string;
    referrer?: string;
    landingUrl?: string;
    gclid?: string;
    gbraid?: string;
    wbraid?: string;
    fbclid?: string;
    fbc?: string;
    fbp?: string;
    clientUserAgent?: string;
  };
}

export interface Client {
  touch(input: TouchInput): Promise<WriteResult>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const defaultBaseUrl = "https://api.fonte.is";

const normalizeTimeout = (value: number | undefined): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 15_000)
    : 3_000;

const requireUuid = (label: string, value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!uuidPattern.test(normalized)) {
    throw new Error(`${label} must be a hyphenated UUID.`);
  }
  return normalized;
};

const requireOrigin = (
  value: string | undefined,
  environment: Environment,
): string | undefined => {
  if (!value) {
    if (environment === "production") {
      throw new Error(
        "fonte_touch_request_origin_required: production touches require the canonical browser Origin assertion",
      );
    }
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "fonte_touch_request_origin_invalid: requestOrigin must be a canonical HTTP(S) origin",
    );
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    value !== parsed.origin ||
    (environment === "production" && parsed.protocol !== "https:")
  ) {
    throw new Error(
      "fonte_touch_request_origin_invalid: requestOrigin must be a canonical HTTP(S) origin",
    );
  }
  return parsed.origin;
};

const touchBody = (input: TouchInput): TouchInput["touch"] => ({
  journeyId: input.touch.journeyId,
  platform: input.touch.platform,
  isPaid: input.touch.isPaid,
  utmSource: input.touch.utmSource,
  utmMedium: input.touch.utmMedium,
  utmCampaign: input.touch.utmCampaign,
  utmContent: input.touch.utmContent,
  utmTerm: input.touch.utmTerm,
  fonteLinkToken: input.touch.fonteLinkToken,
  channelType: input.touch.channelType,
  sourcePlatform: input.touch.sourcePlatform,
  referrer: input.touch.referrer,
  landingUrl: input.touch.landingUrl,
  gclid: input.touch.gclid,
  gbraid: input.touch.gbraid,
  wbraid: input.touch.wbraid,
  fbclid: input.touch.fbclid,
  fbc: input.touch.fbc,
  fbp: input.touch.fbp,
  clientUserAgent: input.touch.clientUserAgent,
});

export function createClient(config: ClientConfig): Client {
  const environment = config.environment ?? "production";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("FONTE_ENVIRONMENT must be sandbox or production.");
  }
  const tenantApiKey = config.tenantApiKey.trim();
  if (tenantApiKey.length < 24) {
    throw new Error("FONTE_TENANT_API_KEY must be at least 24 characters.");
  }
  const baseUrl = (config.baseUrl ?? defaultBaseUrl).trim().replace(/\/+$/, "");
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("FONTE_API_BASE_URL must be an HTTP(S) URL.");
  }
  if (
    (parsedBaseUrl.protocol !== "https:" &&
      parsedBaseUrl.protocol !== "http:") ||
    (environment === "production" &&
      parsedBaseUrl.protocol !== "https:" &&
      !(
        config.allowInsecureLocalhost && localHosts.has(parsedBaseUrl.hostname)
      ))
  ) {
    throw new Error("FONTE_API_BASE_URL must be HTTPS in production.");
  }
  const tenantId = config.tenantId
    ? requireUuid("FONTE_TENANT_ID", config.tenantId)
    : undefined;
  const timeoutMs = normalizeTimeout(config.timeoutMs);

  const headers = {
    Authorization: `Bearer ${tenantApiKey}`,
    Accept: "application/json",
  };

  return {
    async touch(input) {
      const requestOrigin = requireOrigin(input.requestOrigin, environment);
      const path = "/v1/touches";
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
        },
        body: JSON.stringify({
          ...(tenantId ? { tenantId } : {}),
          environment,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt,
          sourceSystem: input.source,
          logicalEventId: input.eventId,
          eventType: input.event,
          rawPayload: input.raw,
          touch: touchBody(input),
        }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok || body?.blocked === true) {
        throw new FonteApiError({
          path,
          status: response.status,
          code: diagnosticCode(body),
        });
      }
      return (body ?? {}) as WriteResult;
    },
  };
}

export { FonteApiError } from "./server-errors.js";
export type { WriteResult } from "./types.js";
export { collect } from "./collect.js";
export type {
  CollectBody,
  CollectEventType,
  Evidence,
  ParseOptions,
  SourceTouchClassification,
  TouchPayload,
} from "./collect.js";
