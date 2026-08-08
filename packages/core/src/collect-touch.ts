import { classifySourceTouch, platformForSource } from "./collect-classify.js";
import type { TouchPayload } from "./collect-types.js";
import type { Scope } from "./types.js";

export function toTouch(scope: Scope, journeyId: string): TouchPayload {
  const classification = classifySourceTouch(scope);
  return {
    journeyId,
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
