import type { CliReceipt } from "./types.js";

export function renderJson(receipt: CliReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}

export function renderHuman(receipt: CliReceipt): string {
  if (receipt.outcome === "planned") {
    const changes = receipt.operations.filter(
      ({ result }) => result === "planned",
    ).length;
    const command =
      receipt.next_action?.kind === "run_command"
        ? receipt.next_action.command
        : "";
    return [
      `Fonte ${receipt.command} plan: ${changes} change${changes === 1 ? "" : "s"}.`,
      "No files changed.",
      `Run ${command} to apply.`,
      "",
    ].join("\n");
  }
  if (receipt.outcome === "blocked") {
    return [
      `Fonte ${receipt.command} blocked: ${receipt.reason}.`,
      "No files changed.",
      "",
    ].join("\n");
  }
  if (receipt.outcome === "removed") {
    return "Fonte was removed.\n";
  }
  if (receipt.state === "prepared") {
    return [
      "Fonte is prepared locally.",
      `Local verification: ${receipt.local_verification}.`,
      "Account created: no.",
      "Provider effect: none.",
      "Application email: unavailable.",
      "Activation: unavailable in this build.",
      "",
    ].join("\n");
  }
  return `Fonte ${receipt.command} failed: ${receipt.reason}.\n`;
}
