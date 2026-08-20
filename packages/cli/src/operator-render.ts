import type { OperatorReceipt } from "./operator-types.js";

export function renderOperatorJson(receipt: OperatorReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}

export function renderOperatorHuman(receipt: OperatorReceipt): string {
  if (receipt.outcome === "unsupported_authority") {
    return "Fonte operation unavailable: unsupported_authority.\nCore effect: none.\n";
  }
  if (receipt.outcome === "blocked") {
    if (receipt.reason === "resend_bridge_unavailable") {
      return [
        "Fonte Resend Bridge could not continue.",
        "Core returned 503: Resend Bridge credential custody is unavailable.",
        `Reason: ${receipt.reason}.`,
        `Core effect: ${receipt.core_effect}.`,
        "",
      ].join("\n");
    }
    return [
      receipt.command.startsWith("bridge_resend_")
        ? "Fonte Resend Bridge could not continue."
        : "Fonte sandbox test could not continue.",
      `Reason: ${receipt.reason}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
  }
  const result = receipt.result!;
  if (result.kind === "resend_bridge_preview") {
    return [
      `Fonte Resend Bridge preview: ${result.pagination.status}.`,
      `Connection: ${result.connection_id}.`,
      `Segment: ${result.segment.name} (${result.segment.id}).`,
      `Observed/protected/unknown contacts: ${result.contacts_observed}/${result.protected.contacts}/${result.unknown.contacts}.`,
      `Pages: contacts ${coverage(result.pagination.contacts)}, suppressions ${coverage(result.pagination.suppressions)}.`,
      `Fingerprint: ${result.observation_fingerprint}.`,
      "Core effect: none.",
      "",
    ].join("\n");
  }
  if (result.kind === "resend_bridge_copy") {
    const reconciliation = result.reconciliation;
    return [
      `Fonte Resend Bridge copy: ${result.import_receipt.created ? "completed" : "idempotent"}.`,
      `Import receipt: ${result.import_receipt.contact_import_batch_id}.`,
      `Accepted/created/updated/unchanged: ${reconciliation.accepted}/${reconciliation.created}/${reconciliation.updated ?? "unknown"}/${reconciliation.unchanged ?? "unknown"}.`,
      `Protected/conflict/unknown: ${reconciliation.protected}/${reconciliation.conflict ?? "unknown"}/${reconciliation.unknown}.`,
      `Fingerprint: ${result.observation_fingerprint}.`,
      `Core effect: ${receipt.core_effect}.`,
      "",
    ].join("\n");
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

function coverage(value: {
  readonly status: "complete" | "partial";
  readonly pages_observed: number;
  readonly has_more: boolean;
}): string {
  return `${value.pages_observed} (${value.status}${value.has_more ? ", more available" : ""})`;
}
