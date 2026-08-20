import { blockerGuidance } from "./blocker-guidance.js";
import { hostedBlockerGuidance } from "./hosted-blocker-guidance.js";
import type { AnyCliReceipt, HostedTestReceipt } from "./types.js";
import { renderOperatorHuman, renderOperatorJson } from "./operator-render.js";

export function renderJson(receipt: AnyCliReceipt): string {
  if (receipt.schema_version === "fonte.cli.operator_receipt.v1") {
    return renderOperatorJson(receipt);
  }
  return `${JSON.stringify(receipt)}\n`;
}

export function renderHuman(receipt: AnyCliReceipt): string {
  if (receipt.schema_version === "fonte.cli.operator_receipt.v1") {
    return renderOperatorHuman(receipt);
  }
  if (receipt.schema_version === "fonte.cli.test_receipt.v1")
    return renderTest(receipt);
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
    const guidance = blockerGuidance(receipt.reason);
    return [
      `Fonte ${receipt.command} could not continue.`,
      guidance.summary,
      `Reason: ${receipt.reason}.`,
      "No Fonte changes were kept.",
      `Next: ${guidance.next}`,
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
      `Sandbox provider proof: run ${receipt.next_action?.kind === "run_command" ? receipt.next_action.command : "fonte test"}.`,
      "",
    ].join("\n");
  }
  return `Fonte ${receipt.command} failed: ${receipt.reason}.\n`;
}

function renderTest(receipt: HostedTestReceipt): string {
  if (receipt.outcome === "blocked") {
    const guidance = hostedBlockerGuidance(receipt.reason);
    return [
      "Fonte test could not continue.",
      guidance.summary,
      `Reason: ${receipt.reason}.`,
      "No provider submission was confirmed.",
      receipt.sandbox_draft_retained === true
        ? `Sandbox draft retained: ${receipt.sandbox_draft_id}.`
        : receipt.sandbox_draft_retained === false
          ? "Sandbox draft retained: no."
          : "Sandbox draft retained: unknown; the create response was lost.",
      `Next: ${guidance.next}`,
      "",
    ].join("\n");
  }
  return [
    `Fonte sandbox provider result: ${receipt.provider_submission}.`,
    `Accepted email usage: ${receipt.accepted_email_usage_quantity ?? "unavailable"}.`,
    `Sandbox draft retained: ${receipt.sandbox_draft_id}.`,
    "Inbox delivery confirmed: no.",
    "Production email: locked pending a verified domain.",
    "Credential stored: no.",
    "",
  ].join("\n");
}
