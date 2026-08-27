import { renderAmbiguousBroadcastRecovery } from "./operator-broadcast-recovery.js";
import type { OperatorReceipt } from "./operator-types.js";

export function renderBlockedOperator(receipt: OperatorReceipt): string {
  if (receipt.reason === "resend_bridge_unavailable") {
    return [
      "Fonte Resend Bridge could not continue.",
      "Core returned 503: Resend Bridge credential custody is unavailable.",
      `Reason: ${receipt.reason}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  if (receipt.reason === "provider_collection_discovery_unavailable") {
    return [
      "Fonte Bridge collection discovery could not continue.",
      "Core returned 503: provider collection discovery or credential custody is unavailable.",
      `Reason: ${receipt.reason}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  return [
    receipt.command.startsWith("bridge_")
      ? "Fonte Bridge operation could not continue."
      : receipt.command === "broadcast_preflight"
        ? "Fonte broadcast preflight could not be observed."
        : receipt.command === "broadcast_test_send" ||
            receipt.command === "broadcast_test_status"
          ? "Fonte sandbox test could not continue."
          : "Fonte production broadcast operation could not continue.",
    ...(receipt.command === "broadcast_preflight"
      ? ["Readiness: unknown."]
      : []),
    `Reason: ${receipt.reason}.`,
    `Core effect: ${receipt.core_effect}.`,
    ...renderAmbiguousBroadcastRecovery(receipt),
    "",
  ].join("\n");
}
