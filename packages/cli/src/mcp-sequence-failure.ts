import { HostedTestBlockedError } from "./hosted-errors.js";
import { CoreOperatorError } from "./operator-core-request.js";

export interface SequenceMcpFailure {
  readonly outcome: "unavailable" | "denied" | "conflict" | "ambiguous";
  readonly reason: string;
  readonly status_code: number | null;
  readonly core_effect: "none" | "unknown";
}

export function sequenceMcpFailure(error: unknown): SequenceMcpFailure {
  if (error instanceof CoreOperatorError) {
    return {
      outcome: coreOutcome(error),
      reason: safeReason(error.reason),
      status_code: error.statusCode,
      core_effect: error.coreEffect,
    };
  }
  if (error instanceof HostedTestBlockedError) {
    return {
      outcome:
        error.reason === "authorization_denied" ? "denied" : "unavailable",
      reason: safeReason(error.reason),
      status_code: null,
      core_effect: "none",
    };
  }
  return {
    outcome: "ambiguous",
    reason: "unexpected_failure",
    status_code: null,
    core_effect: "unknown",
  };
}

function coreOutcome(
  error: CoreOperatorError,
): "unavailable" | "denied" | "conflict" | "ambiguous" {
  if (error.coreEffect === "unknown") return "ambiguous";
  if (error.reason === "core_operator_receipt_invalid") return "ambiguous";
  if (
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.statusCode === 404
  ) {
    return "denied";
  }
  if (
    error.statusCode !== null &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return "conflict";
  }
  return "unavailable";
}

function safeReason(value: string): string {
  return /^[a-z0-9_]{1,100}$/.test(value) ? value : "unexpected_failure";
}
