export type CommandName = "init" | "doctor" | "remove";
export type ParsedCommand = CommandName | "help" | "version";

export interface ParsedArguments {
  command: ParsedCommand;
  apply: boolean;
  json: boolean;
}

export type BlockReason =
  | "ambiguous_app_router_root"
  | "dependency_version_conflict"
  | "existing_unmanaged_path"
  | "installation_manifest_invalid"
  | "installation_not_found"
  | "installed_sdk_invalid"
  | "local_state_not_ignored"
  | "managed_code_drifted"
  | "managed_path_unsafe"
  | "project_check_failed"
  | "project_check_unavailable"
  | "project_manifest_invalid"
  | "unsupported_framework"
  | "unsupported_package_manager";

export type OperationKind =
  "dependency" | "create_file" | "managed_block" | "create_local_manifest";

export type OperationAction = "add" | "create" | "remove" | "none";

export interface PlanOperation {
  id: string;
  kind: OperationKind;
  path: string;
  action: OperationAction;
  sha256?: string;
}

export interface InstallationPlanMaterial {
  schema_version: "fonte.cli.plan.v1";
  command: "init" | "remove";
  adapter_id: "next_app_router";
  adapter_version: "v1";
  package_manager: "npm";
  sdk_package: "@fonte-is/nextjs";
  sdk_version: "0.1.0";
  operations: PlanOperation[];
}

export interface InstallationPlan extends InstallationPlanMaterial {
  plan_sha256: string;
}

export type ManagedOperation =
  | {
      id: "sdk_dependency";
      kind: "dependency";
      path: "package.json";
      package: "@fonte-is/nextjs";
      version: "0.1.0";
      previous: "absent";
    }
  | {
      id: "installation_module";
      kind: "created_file";
      path: "fonte/installation.ts";
      sha256: string;
    }
  | {
      id: "local_state_ignore";
      kind: "managed_block";
      path: ".gitignore";
      sha256: string;
    };

export interface LocalManifest {
  schema_version: "fonte.local_installation.v1";
  installation_id: string;
  cli_version: "0.1.0";
  adapter_id: "next_app_router";
  adapter_version: "v1";
  sdk_package: "@fonte-is/nextjs";
  sdk_version: "0.1.0";
  plan_sha256: string;
  managed_operations: ManagedOperation[];
}

export type ReceiptOutcome =
  "planned" | "applied" | "verified" | "removed" | "blocked" | "failed";

export type ReceiptState = "not_installed" | "prepared" | "drifted";

export interface ReceiptOperation {
  id: string;
  kind: OperationKind;
  path: string;
  result: "planned" | "applied" | "verified" | "removed" | "unchanged";
}

export type ReceiptNextAction =
  | {
      kind: "run_command";
      command: string;
    }
  | {
      kind: "activation_unavailable";
      reason: "fonte_activation_not_implemented";
    }
  | {
      kind: "resolve_blocker";
      reason: BlockReason;
    }
  | null;

export interface CliReceipt {
  schema_version: "fonte.cli.receipt.v1";
  command: CommandName;
  outcome: ReceiptOutcome;
  state: ReceiptState;
  reason: string;
  local_verification: "not_run" | "passed" | "failed";
  account_created: false;
  provider_effect: "none";
  application_email: "unavailable";
  operations: ReceiptOperation[];
  next_action: ReceiptNextAction;
}
