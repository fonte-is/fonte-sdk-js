import { loadHostedConfig } from "./hosted-config.js";
import { HostedTestBlockedError } from "./hosted-errors.js";
import type { PersistentLoginSession } from "./persistent-login.js";
import type { CommandResult } from "./runtime-types.js";

export interface AuthCommandDependencies {
  session: PersistentLoginSession;
  configUrl?: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export const AUTH_HELP_TEXT = [
  "Usage:",
  "  fonte auth login [--switch-account] [--json]",
  "  fonte auth status [--json]",
  "  fonte auth logout [--json]",
  "  fonte auth exec -- <command> [args...]",
  "",
  "Sign in once; later commands refresh silently using the OS credential store.",
  "login --switch-account forgets the current CLI sign-in and opens Fonte again.",
  "status never opens a browser. logout removes this machine's CLI sign-in.",
  "Core checks permission for every action. No access token is saved to disk.",
  "",
].join("\n");

export async function runAuthCommand(
  action: "login" | "status" | "logout",
  switchAccount: boolean,
  json: boolean,
  deps: AuthCommandDependencies,
): Promise<CommandResult> {
  try {
    let state: "signed_in" | "signed_out";
    if (action === "logout") {
      // Logout remains possible when discovery or the identity service is down.
      await deps.session.logout(deps.signal);
      state = "signed_out";
    } else {
      const hosted = await loadHostedConfig(deps.fetch, deps.configUrl);
      if (action === "login") {
        await deps.session.login(hosted, switchAccount, deps.signal);
        state = "signed_in";
      } else state = await deps.session.status(hosted, deps.signal);
    }
    const nextAction = state === "signed_out" ? "fonte auth login" : null;
    return {
      exitCode: action === "status" && state === "signed_out" ? 3 : 0,
      stdout: json
        ? JSON.stringify({
            schema_version: "fonte.cli.auth.v1",
            command: `auth ${action}`,
            state,
            next_action: nextAction,
          }) + "\n"
        : state === "signed_in"
          ? "Signed in to Fonte.\n"
          : "Signed out of Fonte. Run fonte auth login to sign in.\n",
      stderr: "",
    };
  } catch (error) {
    const guidance = loginRecovery(error);
    return {
      exitCode: 3,
      stdout: json
        ? JSON.stringify({
            schema_version: "fonte.cli.auth.v1",
            command: `auth ${action}`,
            state: "unavailable",
            next_action: guidance.trim(),
          }) + "\n"
        : "",
      stderr: json ? "" : guidance,
    };
  }
}

export function loginRecovery(error: unknown): string {
  const reason = error instanceof HostedTestBlockedError ? error.reason : "";
  if (reason === "secure_storage_unavailable") {
    return "Fonte cannot use secure credential storage. Unlock your OS credential store on a supported system, then run fonte auth login.\n";
  }
  if (reason === "login_busy")
    return "Another Fonte login operation is running. Wait for it to finish, then try this command again.\n";
  return "Fonte sign-in is unavailable. Run fonte auth login.\n";
}

export function isLoginFailure(reason: string): boolean {
  return (
    reason.startsWith("login_") ||
    reason.startsWith("authorization_") ||
    reason === "secure_storage_unavailable" ||
    reason === "browser_open_failed"
  );
}
