import type { OperatorCommand, OperatorReceipt } from "./operator-types.js";

export type CommandName = "init" | "doctor" | "remove" | "test";
export type ParsedCommand =
  CommandName | "auth-exec" | "auth-session" | "operator" | "help" | "version";

export interface ParsedArguments {
  command: ParsedCommand;
  apply: boolean;
  json: boolean;
  helpText?: string;
  workspaceSlug?: string;
  consumerCommand?: string;
  consumerArguments?: readonly string[];
  authAction?: "login" | "status" | "logout";
  switchAccount?: boolean;
  operator?: OperatorCommand;
}

export interface InvalidInvocationReceipt {
  readonly schema_version: "fonte.cli.invalid_invocation.v1";
  readonly command: "invalid_invocation";
  readonly outcome: "invalid_invocation";
  readonly reason: "invalid_invocation";
  readonly detail: {
    readonly code: string;
    readonly kind:
      "missing_field" | "invalid_field" | "duplicate_field" | "unknown_field";
    readonly field: string;
  };
  readonly next_action: {
    readonly kind: "run_command";
    readonly command: string;
  };
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
  cli_version:
    "0.1.0" | "0.1.1" | "0.1.2" | "0.1.3" | "0.1.4" | "0.2.0" | "0.3.0";
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

export interface HostedTestReceipt {
  schema_version: "fonte.cli.test_receipt.v2";
  command: "test";
  outcome: "terminal" | "blocked";
  reason: string;
  workspace: string;
  sandbox_draft_id: string | null;
  sandbox_draft_retained: boolean | null;
  local_verification: "passed" | "failed";
  account_created: false;
  production_email: "locked_pending_verified_domain";
  provider_submission:
    "not_requested" | "processing" | "accepted" | "refused" | "unknown";
  provider_message_id: string | null;
  provider_error_code: string | null;
  accepted_email_usage_quantity: number | null;
  inbox_delivery_confirmed: false;
  token_persisted: boolean | null;
}

export type AuthReason =
  | "ok"
  | "authorization_cancelled"
  | "authorization_failed"
  | "authorization_interaction_required"
  | "browser_open_failed"
  | "hosted_configuration_invalid"
  | "hosted_configuration_unavailable"
  | "login_busy"
  | "login_changed"
  | "login_invalid"
  | "login_required"
  | "login_revoked"
  | "login_refresh_unavailable"
  | "login_refresh_uncertain"
  | "secure_storage_interaction_required"
  | "secure_storage_unavailable";

export type AuthNextAction =
  | { readonly kind: "login"; readonly command: "fonte auth login" }
  | { readonly kind: "retry"; readonly target: "original_command" }
  | { readonly kind: "unlock_credential_store" }
  | { readonly kind: "use_supported_credential_environment" }
  | null;

export interface AuthReceipt {
  readonly schema_version: "fonte.cli.auth.v2";
  readonly command: "auth login" | "auth status" | "auth logout";
  readonly outcome: "completed" | "blocked";
  readonly state:
    | "signed_in_local"
    | "signed_out"
    | "login_pending"
    | "refresh_uncertain"
    | "revoked"
    | "unavailable";
  readonly reason: AuthReason;
  readonly session: {
    readonly subject: string;
    readonly issuer: string;
    readonly client_id: string;
    readonly core_api_base_url: string;
  } | null;
  readonly server_check: "token_issued" | "not_checked";
  readonly local_logout: "cleared" | "already_signed_out" | "failed" | null;
  readonly remote_revocation: "revoked" | "unsupported" | "unavailable" | null;
  readonly next_action: AuthNextAction;
}

export type AnyCliReceipt =
  | CliReceipt
  | HostedTestReceipt
  | OperatorReceipt
  | InvalidInvocationReceipt
  | AuthReceipt;
