import { renderAmbiguousBroadcastRecovery } from "./operator-broadcast-recovery.js";
import type { OperatorReceipt } from "./operator-types.js";
import { isLoginFailure, loginRecovery } from "./auth-commands.js";
import { HostedTestBlockedError } from "./hosted-errors.js";

export function renderBlockedOperator(receipt: OperatorReceipt): string {
  return [
    receipt.command.startsWith("campaign_")
      ? "Fonte Campaign metadata operation could not continue."
      : receipt.command.startsWith("segment_")
        ? "Fonte Segment metadata operation could not continue."
        : receipt.command === "bridge_contact_import_status"
          ? "Fonte Contact import could not be read."
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
    ...(isLoginFailure(receipt.reason)
      ? [loginRecovery(new HostedTestBlockedError(receipt.reason)).trim()]
      : []),
    ...renderAmbiguousBroadcastRecovery(receipt),
    "",
  ].join("\n");
}
