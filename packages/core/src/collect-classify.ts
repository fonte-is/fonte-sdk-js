import {
  clean,
  measurementQueryKeys,
  paidMediums,
} from "./collect-contract.js";
import type { SourceTouchClassification } from "./collect-types.js";
import type { Scope } from "./types.js";

export const sourceMatches = (value: string, source: string): boolean =>
  value === source ||
  value.startsWith(`${source}.`) ||
  value.includes(`.${source}.`);

const origin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const sameOrigin = (
  left: string | undefined,
  right: string | undefined,
): boolean => Boolean(left && right && origin(left) === origin(right));

interface SourceSignals {
  googleClick: boolean;
  metaClick: boolean;
  externalReferrer: boolean;
  internalReferrer: boolean;
}

const captureReasonFor = (
  scope: Scope,
  signals: SourceSignals,
): SourceTouchClassification["captureReason"] => {
  if (scope.fonte) return "fonte_source_identity";
  if (signals.googleClick || signals.metaClick || scope.ttclid) {
    return "platform_click_id";
  }
  if (scope.fbp) return "platform_cookie_signal";
  if (measurementQueryKeys.some((key) => scope[key])) return "utm_parameter";
  if (signals.externalReferrer) return "external_referrer";
  if (signals.internalReferrer) return "internal_navigation";
  if (scope.current_url) return "direct_landing";
  return "unknown";
};

const classification = (
  channelType: SourceTouchClassification["channelType"],
  channel: SourceTouchClassification["channel"],
  sourcePlatform: string,
  captureReason: SourceTouchClassification["captureReason"],
): SourceTouchClassification => ({
  channelType,
  channel,
  sourcePlatform,
  captureReason,
});

export function classifySourceTouch(scope: Scope): SourceTouchClassification {
  const source = clean(scope.utm_source, 500).toLowerCase();
  const medium = clean(scope.utm_medium, 500).toLowerCase();
  const internalReferrer = sameOrigin(scope.referrer, scope.current_url);
  const signals: SourceSignals = {
    googleClick: Boolean(scope.gclid || scope.gbraid || scope.wbraid),
    metaClick: Boolean(scope.fbclid || scope.fbc),
    externalReferrer: Boolean(scope.referrer && !internalReferrer),
    internalReferrer,
  };
  const captureReason = captureReasonFor(scope, signals);

  if (signals.googleClick) {
    return classification("paid", "paid_search", "google", captureReason);
  }
  if (signals.metaClick) {
    return classification("paid", "paid_social", "meta", captureReason);
  }
  if (scope.fonte) {
    return classification("unknown", "unknown", "fonte", captureReason);
  }
  if (medium === "email") {
    return classification(
      "owned",
      "owned_email",
      source || "email",
      captureReason,
    );
  }
  if (medium === "sms") {
    return classification("owned", "owned_sms", source || "sms", captureReason);
  }
  if (sourceMatches(source, "google")) {
    const paid = paidMediums.has(medium);
    return classification(
      paid ? "paid" : "organic",
      paid ? "paid_search" : "organic_search",
      "google",
      captureReason,
    );
  }
  if (
    ["facebook", "instagram", "meta"].some((name) =>
      sourceMatches(source, name),
    )
  ) {
    const paid = paidMediums.has(medium);
    return classification(
      paid ? "paid" : "organic",
      paid ? "paid_social" : "organic_social",
      source || "meta",
      captureReason,
    );
  }
  if (signals.externalReferrer) {
    let platform = source;
    try {
      platform ||= new URL(scope.referrer ?? "").hostname.toLowerCase();
    } catch {
      // The normalized referrer remains classified as unknown when it is not a URL.
    }
    return classification(
      "referral",
      "referral",
      platform || "referral",
      captureReason,
    );
  }
  if (
    captureReason === "utm_parameter" ||
    captureReason === "platform_cookie_signal"
  ) {
    return classification(
      "unknown",
      "unknown",
      source || "unknown",
      captureReason,
    );
  }
  if (scope.current_url && !internalReferrer) {
    return classification(
      "direct",
      "direct",
      source || "direct",
      captureReason,
    );
  }
  return classification(
    "unknown",
    "unknown",
    source || "unknown",
    captureReason,
  );
}

export function platformForSource(source: string): "meta" | "google" | "other" {
  if (sourceMatches(source, "google")) return "google";
  if (
    ["facebook", "instagram", "meta"].some((name) =>
      sourceMatches(source, name),
    )
  ) {
    return "meta";
  }
  return "other";
}
