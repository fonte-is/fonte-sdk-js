import { renderProductionOperatorHuman } from "./operator-production-render.js";
import { renderBroadcastSendInstructionHuman } from "./operator-broadcast-send-instruction-render.js";
import { renderWorkspaceMarketingSettings } from "./operator-marketing-settings-render.js";
import { renderBlockedOperator } from "./operator-blocked-render.js";

import { renderSequenceOperatorHuman } from "./operator-sequence-render.js";

import type { OperatorReceipt } from "./operator-types.js";

export function renderOperatorJson(receipt: OperatorReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}

export function renderOperatorHuman(receipt: OperatorReceipt): string {
  if (receipt.outcome === "unsupported_authority") {
    return "Fonte operation unavailable: unsupported_authority.\nCore effect: none.\n";
  }
  if (receipt.outcome === "blocked" && receipt.result === null) {
    return renderBlockedOperator(receipt);
  }
  const send = renderBroadcastSendInstructionHuman(receipt);
  if (send !== null) return send;
  const production = renderProductionOperatorHuman(receipt);
  if (production !== null) return production;
  const marketingSettings = renderWorkspaceMarketingSettings(receipt);
  if (marketingSettings !== null) return marketingSettings;
  const sequence = renderSequenceOperatorHuman(receipt);
  if (sequence !== null) return sequence;
  const result = receipt.result!;
  if (!result.kind) return `${JSON.stringify(result, null, 2)}\n`;
  if (result.kind === "contact_import_status") {
    return [
      "Fonte Contact import: completed.",
      `Contact import batch: ${result.contact_import_batch_id}.`,
      `Identity set SHA-256: ${result.identity_set_sha256}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind !== "sandbox_test") {
    throw new TypeError("operator_receipt_unrenderable");
  }
  return [
    `Fonte sandbox test: ${result.status}.`,
    `Accepted/refused/unknown: ${counts(result)}.`,
    `Accepted email usage: ${result.accepted_email_usage_quantity ?? "pending"}.`,
    "Recipient: signed-in account's verified email (address withheld).",
    "",
  ].join("\n");
}

function counts(result: NonNullable<OperatorReceipt["result"]>): string {
  if (result.kind !== "sandbox_test") return "unavailable";
  return [result.accepted_count, result.refused_count, result.unknown_count]
    .map((value) => value ?? "pending")
    .join("/");
}
