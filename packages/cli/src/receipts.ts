import { RECEIPT_SCHEMA_VERSION } from "./constants.js";
import type {
  BlockReason,
  CliReceipt,
  CommandName,
  InstallationPlan,
  ReceiptOperation,
} from "./types.js";

const receiptOperations = (
  plan: InstallationPlan,
  result: ReceiptOperation["result"],
): ReceiptOperation[] =>
  plan.operations.map(({ id, kind, path, action }) => ({
    id,
    kind,
    path,
    result: action === "none" ? "unchanged" : result,
  }));

export function plannedReceipt(plan: InstallationPlan): CliReceipt {
  const command = plan.command;
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    command,
    outcome: "planned",
    state: command === "init" ? "not_installed" : "prepared",
    reason:
      command === "init" ? "installation_plan_ready" : "removal_plan_ready",
    local_verification: "not_run",
    account_created: false,
    provider_effect: "none",
    application_email: "unavailable",
    operations: receiptOperations(plan, "planned"),
    next_action: {
      kind: "run_command",
      command: `npx @fonte-is/cli ${command} --yes`,
    },
  };
}

export function blockedReceipt(
  command: CommandName,
  reason: BlockReason,
): CliReceipt {
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    command,
    outcome: "blocked",
    state: reason === "managed_code_drifted" ? "drifted" : "not_installed",
    reason,
    local_verification: "failed",
    account_created: false,
    provider_effect: "none",
    application_email: "unavailable",
    operations: [],
    next_action: { kind: "resolve_blocker", reason },
  };
}

export function activationUnavailable(): CliReceipt["next_action"] {
  return {
    kind: "activation_unavailable",
    reason: "fonte_activation_not_implemented",
  };
}

export function preparedReceipt(
  command: "init" | "doctor",
  plan: InstallationPlan,
  outcome: "applied" | "verified",
): CliReceipt {
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    command,
    outcome,
    state: "prepared",
    reason:
      outcome === "applied" ? "installation_prepared" : "installation_verified",
    local_verification: "passed",
    account_created: false,
    provider_effect: "none",
    application_email: "unavailable",
    operations: receiptOperations(plan, outcome),
    next_action: activationUnavailable(),
  };
}

export function removedReceipt(plan: InstallationPlan): CliReceipt {
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    command: "remove",
    outcome: "removed",
    state: "not_installed",
    reason: "installation_removed",
    local_verification: "not_run",
    account_created: false,
    provider_effect: "none",
    application_email: "unavailable",
    operations: receiptOperations(plan, "removed"),
    next_action: null,
  };
}
