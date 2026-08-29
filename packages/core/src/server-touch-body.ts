import type { TouchInput } from "./server.js";

export const serializeTouchBody = (
  input: TouchInput,
  journeyId: string,
): TouchInput["touch"] => ({
  journeyId,
  journeyIdentityScope: input.touch.journeyIdentityScope,
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
