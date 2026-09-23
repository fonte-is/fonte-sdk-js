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
  "  fonte auth login [--switch-account] [--json]",
  "  fonte auth status [--json]",
  "  fonte auth logout [--json]",
  "  fonte auth exec -- <command> [args...]",
  "",
  "Sign in once; later commands reuse the selected credential store and refresh silently.",
  "If native storage is unavailable, interactive login can select a private per-user file.",
  "login --switch-account replaces the one active Fonte sign-in.",
  "status reads local custody without contacting Fonte. logout clears local custody.",
  "Logout cannot revoke already issued tokens or sessions on other installations.",
  "Core checks permission for every action. No access token is saved to disk.",
  "",
].join("\n");

export async function runAuthCommand(
  action: "login" | "status" | "logout",
  switchAccount: boolean,
  json: boolean,
  deps: AuthCommandDependencies,
): Promise<CommandResult> {
  let receipt: AuthReceipt;
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
      receipt = statusReceipt(await deps.session.status(deps.signal));
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
    stdout: json ? `${JSON.stringify(receipt)}\n` : renderAuthHuman(receipt),
    stderr: "",
    receipt,
  };
}

export function loginRecovery(error: unknown): string {
  const reason =
    error instanceof HostedTestBlockedError
      ? error.reason
      : "authorization_failed";
  if (reason === "secure_storage_interaction_required")
    return "Unlock the OS credential store, then retry this command.\n";
  if (reason === "secure_storage_unavailable")
    return "Fonte cannot use the selected credential store here. Run fonte auth login interactively to choose a supported store.\n";
  if (reason === "login_busy")
    return "Another Fonte login operation is running. Wait for it to finish, then retry.\n";
  if (reason === "login_refresh_unavailable")
    return "Fonte could not reach the identity service before refreshing. Retry this command.\n";
  if (reason === "login_refresh_uncertain")
    return "Fonte could not confirm the refresh outcome. Run fonte auth login.\n";
  return "Fonte sign-in is unavailable. Run fonte auth login.\n";
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

function renderAuthHuman(receipt: AuthReceipt): string {
  if (receipt.outcome === "blocked")
    return [
      `Fonte ${receipt.command} could not continue.`,
      `Reason: ${receipt.reason}.`,
      `Next: ${humanNext(receipt.next_action)}`,
      "",
    ].join("\n");
  if (receipt.command === "auth logout")
    return [
      receipt.local_logout === "already_signed_out"
        ? "Fonte was already signed out locally."
        : "Local Fonte sign-in cleared.",
      "Remote revocation is unsupported; issued tokens and other installations are unchanged.",
      "",
    ].join("\n");
  if (receipt.server_check === "token_issued")
    return "Signed in to Fonte. A verified server token was issued.\n";
  return "Fonte is signed in locally. Server status was not checked.\n";
}

function humanNext(action: AuthNextAction): string {
  if (action === null) return "None.";
  if (action.kind === "login") return `${action.command}.`;
  if (action.kind === "retry") return "Retry the original command.";
  if (action.kind === "unlock_credential_store")
    return "Unlock the OS credential store and retry.";
  if (action.kind === "select_user_private_store")
    return `Run ${action.command} interactively and select the private per-user file store.`;
  return "Use an environment with a supported secure credential store.";
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
