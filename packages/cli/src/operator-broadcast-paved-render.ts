import { renderOperatorHuman } from "./operator-render.js";
import type { BroadcastPavedPreparationResult } from "./operator-broadcast-paved.js";
import type { OperatorReceipt } from "./operator-types.js";

export function renderBroadcastPavedPreparationHuman(
  result: BroadcastPavedPreparationResult,
): string {
  const status =
    result.status === "ready_to_send"
      ? "ready to send"
      : result.status === "needs_input"
        ? "needs input"
        : result.status;
  const lines = [`Fonte Broadcast preparation: ${status}.`];
  if (result.status === "ready_to_send") {
    if (result.draft_id && result.revision !== null) {
      lines.push(`Draft revision: ${result.revision}.`);
    }
    lines.push("No Send or Test Send was attempted.");
  } else if (result.status === "needs_input") {
    if (result.missing.length > 0) {
      lines.push(`Missing: ${result.missing.join(", ")}.`);
    }
    if (result.choices.length > 0) {
      const counts = new Map<string, number>();
      for (const choice of result.choices) {
        counts.set(choice.field, (counts.get(choice.field) ?? 0) + 1);
      }
      lines.push(
        `Choices available: ${[...counts]
          .map(([field, count]) => `${field} (${count})`)
          .join(", ")}.`,
      );
    }
    lines.push("No Send or Test Send was attempted.");
  } else if (result.status === "blocked") {
    const warning = result.warnings.find((value) =>
      /^[a-z0-9_]{1,100}$/u.test(value),
    );
    if (warning) lines.push(`Reason: ${warning}.`);
    lines.push("No Send or Test Send was attempted.");
  } else {
    lines.push("No Send or Test Send was attempted.");
  }
  lines.push("");
  return lines.join("\n");
}

export function renderBroadcastPavedSendHuman(
  receipt: OperatorReceipt,
): string {
  return renderOperatorHuman(receipt);
}
