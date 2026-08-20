import type { OperatorReceipt } from "./operator-types.js";

export function renderOperatorJson(receipt: OperatorReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}

export function renderOperatorHuman(receipt: OperatorReceipt): string {
  if (receipt.outcome === "unsupported_authority") {
    return "Fonte operation unavailable: unsupported_authority.\nCore effect: none.\n";
  }
  if (receipt.outcome === "blocked") {
    return [
      "Fonte sandbox test could not continue.",
      `Reason: ${receipt.reason}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  const result = receipt.result!;
  return [
    `Fonte sandbox test: ${result.status}.`,
    `Accepted/refused/unknown: ${counts(result)}.`,
    `Accepted email usage: ${result.accepted_email_usage_quantity ?? "pending"}.`,
    "Recipient: signed-in account's verified email (address withheld).",
    "",
  ].join("\n");
}

function counts(result: NonNullable<OperatorReceipt["result"]>): string {
  return [result.accepted_count, result.refused_count, result.unknown_count]
    .map((value) => value ?? "pending")
    .join("/");
}
