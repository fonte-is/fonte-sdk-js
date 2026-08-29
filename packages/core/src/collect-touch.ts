import { classifySourceTouch, platformForSource } from "./collect-classify.js";
import type { CollectBody, TouchPayload } from "./collect-types.js";
import type { TouchInput } from "./server.js";
import type { Scope } from "./types.js";

export function toTouch(
  scope: Scope,
  journeyId?: string,
  journeyIdentityScope: TouchPayload["journeyIdentityScope"] = "persistent_first_party",
): TouchPayload {
  const classification = classifySourceTouch(scope);
  return {
    ...(journeyId ? { journeyId } : {}),
    journeyIdentityScope,
    platform: platformForSource(classification.sourcePlatform.toLowerCase()),
    isPaid: classification.channelType === "paid",
    fonteLinkToken: scope.fonte,
    channelType: classification.channelType,
    sourcePlatform: classification.sourcePlatform,
    utmSource: scope.utm_source,
    utmMedium: scope.utm_medium,
    utmCampaign: scope.utm_campaign,
    utmContent: scope.utm_content,
    utmTerm: scope.utm_term,
    referrer: scope.referrer,
    landingUrl: scope.current_url,
    gclid: scope.gclid,
    gbraid: scope.gbraid,
    wbraid: scope.wbraid,
    fbclid: scope.fbclid,
    fbc: scope.fbc,
    fbp: scope.fbp,
    clientUserAgent: scope.client_user_agent,
  };
}

export function toTouchInput(
  body: CollectBody,
  acceptedScope: Scope,
  source: string,
): TouchInput {
  const requestOrigin = new URL(acceptedScope.current_url).origin;
  return {
    idempotencyKey: body.eventId,
    occurredAt: body.occurredAt,
    source,
    requestOrigin,
    eventId: body.eventId,
    event: body.eventType,
    raw: {
      browserObservation: {
        schemaVersion: body.schemaVersion,
        eventId: body.eventId,
        eventType: body.eventType,
        occurredAt: body.occurredAt,
        ...(body.journeyId ? { journeyId: body.journeyId } : {}),
        journeyIdentityScope: body.journeyIdentityScope,
        scope: acceptedScope,
      },
      collectionPostureObservation: body.collectionPostureObservation,
      ...(body.verification ? { verification: body.verification } : {}),
    },
    touch: toTouch(acceptedScope, body.journeyId, body.journeyIdentityScope),
  };
}
