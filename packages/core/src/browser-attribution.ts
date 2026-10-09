import { measurementQueryKeys } from "./collect-contract.js";
import type { Scope } from "./types.js";
import type { SourceEvidence } from "./source-evidence.js";
const externalReferrer = (referrer: string, currentUrl: string): boolean => {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin !== new URL(currentUrl).origin;
  } catch {
    return false;
  }
};
export function shouldCaptureSourceTouch(
  scope: Scope,
  evidence: SourceEvidence,
  policy: { mode: "source_touch" | "all"; captureDirectLanding?: boolean },
): boolean {
  if (policy.mode === "all") return true;
  if (
    scope.fonte ||
    measurementQueryKeys.some((key) => scope[key]) ||
    evidence.query.length ||
    externalReferrer(scope.referrer ?? "", scope.current_url)
  )
    return true;
  return policy.captureDirectLanding !== false;
}
