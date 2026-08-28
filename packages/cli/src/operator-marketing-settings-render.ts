import type { OperatorReceipt } from "./operator-types.js";

export function renderWorkspaceMarketingSettings(
  receipt: OperatorReceipt,
): string | null {
  const result = receipt.result;
  if (result?.kind !== "workspace_marketing_settings") return null;
  return [
    "Fonte workspace marketing settings: available.",
    `Workspace: ${result.workspaceId}.`,
    `Environment: ${result.environment}.`,
    `Postal address: ${result.postalAddress}.`,
    `Updated: ${result.updatedAt}.`,
    "Core effect: none.",
    "",
  ].join("\n");
}
