import type { ClientAuthRuntime } from "./client-auth-runtime.js";
import type { SessionStatus } from "./client-auth-types.js";
import { EXECUTION_ERROR_TEXT } from "./constants.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import type { CommandResult } from "./runtime-types.js";
import type {
  AuthNextAction,
  AuthReason,
  AuthReceipt,
  AuthStorageInfo,
} from "./types.js";

export interface AuthCommandDependencies {
  session: Pick<ClientAuthRuntime, "login" | "status" | "logout"> & {
    storageInfo?: () => Promise<AuthStorageInfo | undefined>;
  };
  signal?: AbortSignal;
}

export const AUTH_HELP_TEXT = [
  "Usage:",
  "  fonte auth login [--switch-account] [--json] [--verbose]",
  "  fonte auth status [--json] [--verbose]",
  "  fonte auth logout [--json] [--verbose]",
  "  fonte auth exec [--verbose] -- <command> [args...]",
  "",
  "Sign in once; later commands use your saved Fonte sign-in.",
  "Use --switch-account to replace the current sign-in.",
  "Status checks your saved sign-in without contacting Fonte. Logout signs out on this device.",
  "Use --json for structured output or --verbose for troubleshooting details.",
  "",
].join("\n");

export async function runAuthCommand(
  action: "login" | "status" | "logout",
  switchAccount: boolean,
  json: boolean,
  deps: AuthCommandDependencies,
  verbose = false,
): Promise<CommandResult> {
  let receipt: AuthReceipt;
  let localState: SessionStatus["state"] | undefined;
  try {
    if (action === "logout") {
      const result = await deps.session.logout(deps.signal);
      receipt =
        result.local === "failed"
          ? blockedReceipt(
              action,
              "unavailable",
              "secure_storage_unavailable",
              { kind: "use_supported_credential_environment" },
              result.local,
              result.remote,
            )
          : completedReceipt(
              action,
              "signed_out",
              null,
              "not_checked",
              result.local,
              result.remote,
            );
    } else if (action === "status") {
      const status = await deps.session.status(deps.signal);
      localState = status.state;
      receipt = statusReceipt(status);
    } else {
      const result = await deps.session.login(switchAccount, deps.signal);
      if (result.status.state !== "ready")
        throw new HostedTestBlockedError("login_invalid");
      receipt = completedReceipt(
        action,
        "signed_in_local",
        localSession(result.status),
        result.serverCheck,
      );
    }
  } catch (error) {
    if (!(error instanceof HostedTestBlockedError)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: EXECUTION_ERROR_TEXT,
      };
    }
    receipt = failureReceipt(action, error);
  }
  const storage = await deps.session.storageInfo?.();
  if (storage) receipt = { ...receipt, storage };
  return {
    exitCode: receipt.outcome === "completed" ? 0 : 3,
    stdout: json
      ? `${JSON.stringify(receipt)}\n`
      : renderAuthHuman(receipt, { verbose, localState }),
    stderr: "",
    receipt,
  };
}

export function loginRecovery(error: unknown, verbose = false): string {
  const reason =
    error instanceof HostedTestBlockedError
      ? error.reason
      : typeof error === "string"
        ? error
        : "authorization_failed";
  return humanLoginRecovery(reason, verbose);
}

export function humanLoginRecovery(reason: string, verbose = false): string {
  const safeReason = knownDiagnosticReason(reason)
    ? reason
    : "authorization_failed";
  let message: string;
  switch (safeReason) {
    case "login_busy":
      message =
        "Another Fonte sign-in is already in progress.\nFinish it in your browser, or try again in a moment.\n";
      break;
    case "login_pending_expired":
      message =
        "Your previous sign-in didn't finish.\n\nRun:\n  fonte auth login\n";
      break;
    case "authorization_interaction_required":
    case "login_required":
      message = "Fonte needs you to sign in.\n\nRun:\n  fonte auth login\n";
      break;
    case "oauth_client_route_denied":
      message =
        "Fonte couldn't use your current sign-in for this action.\n\nTry:\n  fonte auth login\n";
      break;
    case "secure_storage_interaction_required":
      message =
        "Unlock the credential store Fonte uses, then retry the command.\n";
      break;
    case "secure_storage_unavailable":
      message =
        "Fonte couldn't access your saved sign-in here.\n\nRun:\n  fonte auth login\n";
      break;
    case "login_refresh_unavailable":
      message =
        "Fonte couldn't refresh your sign-in right now. Try the command again in a moment.\n";
      break;
    case "login_refresh_uncertain":
      message =
        "Fonte couldn't confirm that your sign-in refreshed.\n\nRun:\n  fonte auth login\n";
      break;
    case "login_revoked":
      message =
        "Your Fonte sign-in is no longer valid.\n\nRun:\n  fonte auth login\n";
      break;
    case "login_changed":
      message =
        "Your Fonte sign-in changed while this command was running.\n\nRun:\n  fonte auth login\n";
      break;
    case "login_invalid":
      message =
        "Fonte couldn't read your saved sign-in.\n\nRun:\n  fonte auth login\n";
      break;
    case "authorization_cancelled":
      message =
        "Fonte sign-in was canceled.\n\nRun:\n  fonte auth login to try again\n";
      break;
    case "hosted_configuration_invalid":
    case "hosted_configuration_unavailable":
      message =
        "Fonte sign-in isn't available in this environment. Contact your administrator to restore it.\n";
      break;
    default:
      message =
        "Fonte couldn't complete sign-in.\n\nRun:\n  fonte auth login to try again\n";
  }
  return verbose
    ? `${message.trimEnd()}\n\nDiagnostic reason: ${safeReason}.\n`
    : message;
}

export function isHumanLoginRecovery(reason: string): boolean {
  return (
    reason.startsWith("login_") ||
    reason.startsWith("authorization_") ||
    reason === "oauth_client_route_denied" ||
    reason === "secure_storage_interaction_required" ||
    reason === "secure_storage_unavailable" ||
    reason === "browser_open_failed"
  );
}

export function isLoginFailure(reason: string): boolean {
  return (
    reason.startsWith("login_") ||
    reason.startsWith("authorization_") ||
    reason === "secure_storage_interaction_required" ||
    reason === "secure_storage_unavailable" ||
    reason === "browser_open_failed"
  );
}

function statusReceipt(status: SessionStatus): AuthReceipt {
  if (status.state === "ready")
    return completedReceipt(
      "status",
      "signed_in_local",
      localSession(status),
      "not_checked",
    );
  if (
    status.state === "absent" ||
    status.state === "signed_out" ||
    status.state === "login_pending_expired"
  )
    return blockedReceipt(
      "status",
      "signed_out",
      "login_required",
      loginAction(),
    );
  if (status.state === "login_pending")
    return blockedReceipt(
      "status",
      "login_pending",
      "login_busy",
      retryAction(),
    );
  if (
    status.state === "refresh_pending" ||
    status.state === "refresh_uncertain"
  )
    return blockedReceipt(
      "status",
      "refresh_uncertain",
      "login_refresh_uncertain",
      loginAction(),
      null,
      null,
      localSession(status),
    );
  return blockedReceipt(
    "status",
    "revoked",
    "login_revoked",
    loginAction(),
    null,
    null,
    localSession(status),
  );
}

function failureReceipt(
  action: "login" | "status" | "logout",
  error: unknown,
): AuthReceipt {
  const raw =
    error instanceof HostedTestBlockedError
      ? error.reason
      : "authorization_failed";
  const reason = knownReason(raw) ? raw : "authorization_failed";
  if (reason === "login_required")
    return blockedReceipt(action, "signed_out", reason, loginAction());
  if (reason === "login_busy")
    return blockedReceipt(action, "login_pending", reason, retryAction());
  if (reason === "login_refresh_uncertain")
    return blockedReceipt(action, "refresh_uncertain", reason, loginAction());
  if (reason === "login_revoked")
    return blockedReceipt(action, "revoked", reason, loginAction());
  if (reason === "secure_storage_interaction_required")
    return blockedReceipt(action, "unavailable", reason, {
      kind: "unlock_credential_store",
    });
  if (reason === "secure_storage_unavailable")
    return blockedReceipt(action, "unavailable", reason, {
      kind: "select_user_private_store",
      command: "fonte auth login",
    });
  if (
    reason === "login_refresh_unavailable" ||
    reason === "authorization_cancelled" ||
    reason === "hosted_configuration_unavailable"
  )
    return blockedReceipt(action, "unavailable", reason, retryAction());
  return blockedReceipt(action, "unavailable", reason, loginAction());
}

function completedReceipt(
  action: "login" | "status" | "logout",
  state: AuthReceipt["state"],
  session: AuthReceipt["session"],
  serverCheck: AuthReceipt["server_check"],
  localLogout: AuthReceipt["local_logout"] = null,
  remoteRevocation: AuthReceipt["remote_revocation"] = null,
): AuthReceipt {
  return {
    schema_version: "fonte.cli.auth.v2",
    command: `auth ${action}`,
    outcome: "completed",
    state,
    reason: "ok",
    session,
    server_check: serverCheck,
    local_logout: localLogout,
    remote_revocation: remoteRevocation,
    next_action: null,
  };
}

function blockedReceipt(
  action: "login" | "status" | "logout",
  state: AuthReceipt["state"],
  reason: AuthReason,
  nextAction: AuthNextAction,
  localLogout: AuthReceipt["local_logout"] = null,
  remoteRevocation: AuthReceipt["remote_revocation"] = null,
  session: AuthReceipt["session"] = null,
): AuthReceipt {
  return {
    schema_version: "fonte.cli.auth.v2",
    command: `auth ${action}`,
    outcome: "blocked",
    state,
    reason,
    session,
    server_check: "not_checked",
    local_logout: localLogout,
    remote_revocation: remoteRevocation,
    next_action: nextAction,
  };
}

function localSession(status: SessionStatus): AuthReceipt["session"] {
  if (!status.binding || !status.subject)
    throw new HostedTestBlockedError("login_invalid");
  return {
    subject: status.subject,
    issuer: status.binding.issuer,
    client_id: status.binding.clientId,
    core_api_base_url: status.binding.coreApiTarget,
  };
}

interface AuthHumanOptions {
  readonly verbose: boolean;
  readonly localState?: SessionStatus["state"];
}

function renderAuthHuman(
  receipt: AuthReceipt,
  options: AuthHumanOptions,
): string {
  let message: string;
  let diagnosticReason: string = receipt.reason;
  if (receipt.outcome === "blocked") {
    if (options.localState === "login_pending_expired")
      diagnosticReason = "login_pending_expired";
    message = humanLoginRecovery(diagnosticReason, false).trimEnd();
  } else if (receipt.command === "auth logout") {
    message =
      receipt.local_logout === "already_signed_out"
        ? "You're already signed out."
        : "Signed out of Fonte.";
  } else if (receipt.command === "auth login") {
    message =
      receipt.server_check === "not_checked"
        ? "You're already signed in to Fonte."
        : "Signed in to Fonte\nYou're ready to use Fonte.";
  } else {
    message = "Signed in to Fonte\n\nStatus: Ready";
  }

  const lines = message.split("\n");
  const storageDisclosure = storageDisclosureFor(receipt);
  if (storageDisclosure) lines.push("", ...storageDisclosure.split("\n"));
  if (options.verbose) {
    lines.push("", "Diagnostics:");
    if (receipt.session?.core_api_base_url)
      lines.push(`Core API endpoint: ${receipt.session.core_api_base_url}`);
    if (receipt.storage)
      lines.push(`Credential storage: ${storageDescription(receipt.storage)}`);
    if (receipt.command === "auth status")
      lines.push("Session check: Local sign-in only; no server check was made");
    else if (receipt.server_check === "token_issued")
      lines.push("Session check: Fonte confirmed sign-in");
    if (receipt.outcome === "blocked" || receipt.reason !== "ok")
      lines.push(`Reason code: ${diagnosticReason}`);
  }
  return `${lines.join("\n")}\n`;
}

function loginAction(): AuthNextAction {
  return { kind: "login", command: "fonte auth login" };
}

function retryAction(): AuthNextAction {
  return { kind: "retry", target: "original_command" };
}

function knownReason(value: string): value is AuthReason {
  return [
    "ok",
    "authorization_cancelled",
    "authorization_failed",
    "authorization_interaction_required",
    "browser_open_failed",
    "hosted_configuration_invalid",
    "hosted_configuration_unavailable",
    "login_busy",
    "login_changed",
    "login_invalid",
    "login_required",
    "login_revoked",
    "login_refresh_unavailable",
    "login_refresh_uncertain",
    "secure_storage_interaction_required",
    "secure_storage_unavailable",
  ].includes(value);
}

function knownDiagnosticReason(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,79}$/.test(value);
}

function storageDisclosureFor(receipt: AuthReceipt): string | undefined {
  if (
    receipt.state !== "signed_in_local" ||
    receipt.storage?.status !== "available"
  )
    return undefined;
  if (receipt.storage.backend === "user_private_file") {
    const detail =
      process.platform === "darwin"
        ? "Your sign-in is stored in a private file on this Mac because Keychain isn't available here."
        : "Your sign-in is stored in a private file on this device because secure credential storage isn't available here.";
    return `${detail}\n\nRun fonte auth status --verbose for details.`;
  }
  if (receipt.storage.backend === "native_secure_store")
    return process.platform === "darwin"
      ? "Your sign-in is saved on this Mac."
      : "Your sign-in is saved on this device.";
  return undefined;
}

function storageDescription(storage: AuthStorageInfo): string {
  if (storage.backend === "user_private_file")
    return `Private per-user file (${storage.status})`;
  if (storage.backend === "native_secure_store")
    return `Native secure storage (${storage.status})`;
  return `Not available (${storage.status})`;
}
