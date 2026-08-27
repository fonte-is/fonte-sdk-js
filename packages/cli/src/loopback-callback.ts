import { randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { HostedTestBlockedError } from "./hosted-errors.js";
import {
  renderCallbackPage,
  type CallbackPageOutcome,
} from "./loopback-callback-page.js";
import { parseOAuthCallback } from "./oauth-callback.js";

type ActiveAuthorizationSessionPhase =
  "exchanging" | "validating" | "committing_grant";
type TerminalAuthorizationSessionPhase =
  "complete" | "failed" | "expired" | "cancelled";
type AuthorizationSessionPhase =
  | "awaiting_callback"
  | "callback_received"
  | ActiveAuthorizationSessionPhase
  | TerminalAuthorizationSessionPhase;

export interface CallbackListener {
  readonly callback: Promise<URL>;
  readonly boundPort: number;
  transition(phase: ActiveAuthorizationSessionPhase): void;
  finish(phase: TerminalAuthorizationSessionPhase): void;
  close(): void;
}

export interface CallbackListenerOptions {
  readonly bindPort?: number;
  readonly finalStateGraceMs?: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const DEFAULT_FINAL_STATE_GRACE_MS = 5_000;

export async function listenForOAuthCallback(
  expectedState: string,
  options: CallbackListenerOptions = {},
): Promise<CallbackListener> {
  let resolveCallback!: (url: URL) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<URL>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const statusPath = `/status/${randomBytes(32).toString("base64url")}`;
  let callbackSettled = false;
  let phase: AuthorizationSessionPhase = "awaiting_callback";
  let finalTimer: NodeJS.Timeout | undefined;
  let authorizationTimer: NodeJS.Timeout | undefined;
  const finalStateGraceMs =
    options.finalStateGraceMs ?? DEFAULT_FINAL_STATE_GRACE_MS;

  const clearCallbackTimeout = () => {
    if (authorizationTimer) clearTimeout(authorizationTimer);
  };
  const cleanupAuthorizationLifetime = () => {
    clearCallbackTimeout();
    options.signal?.removeEventListener("abort", cancel);
  };
  const close = () => {
    cleanupAuthorizationLifetime();
    if (finalTimer) clearTimeout(finalTimer);
    if (server.listening) server.close();
  };
  const finish = (next: TerminalAuthorizationSessionPhase) => {
    if (isTerminal(phase)) return;
    if (next === "complete" && phase !== "committing_grant")
      throw new HostedTestBlockedError("authorization_failed");
    phase = next;
    cleanupAuthorizationLifetime();
    finalTimer = setTimeout(close, finalStateGraceMs);
  };
  const rejectPendingCallback = (error: HostedTestBlockedError) => {
    if (callbackSettled) return;
    callbackSettled = true;
    rejectCallback(error);
  };
  const terminate = (
    reason: "authorization_cancelled" | "authorization_timeout",
    terminal: "cancelled" | "expired",
  ) => {
    rejectPendingCallback(new HostedTestBlockedError(reason));
    finish(terminal);
  };
  const cancel = () => terminate("authorization_cancelled", "cancelled");
  const expire = () => terminate("authorization_timeout", "expired");

  const consumeCallback = (settle: () => void): boolean => {
    if (phase !== "awaiting_callback") return false;
    callbackSettled = true;
    phase = "callback_received";
    clearCallbackTimeout();
    settle();
    return true;
  };
  const acceptCallback = (url: URL) =>
    consumeCallback(() => resolveCallback(url));
  const acceptDeniedCallback = (error: HostedTestBlockedError) => {
    if (consumeCallback(() => rejectCallback(error))) finish("failed");
  };

  const server = createServer((request, response) => {
    if (
      request.method === "GET" &&
      isExactStatusRequest(request.url ?? "", request.headers.host, statusPath)
    ) {
      writePage(response, 200, projectPhase(phase));
      return;
    }
    try {
      if (request.method !== "GET")
        throw new HostedTestBlockedError("authorization_callback_invalid");
      const url = parseOAuthCallback(
        request.url ?? "",
        request.headers.host,
        expectedState,
      );
      acceptCallback(url);
      redirectToStatus(response, statusPath);
    } catch (error) {
      if (
        error instanceof HostedTestBlockedError &&
        error.reason === "authorization_denied"
      ) {
        acceptDeniedCallback(error);
        redirectToStatus(response, statusPath);
        return;
      }
      writePage(response, 400, "failed");
    }
  });

  const boundPort = await bind(server, options.bindPort ?? 49671);
  if (options.signal?.aborted) {
    close();
    throw new HostedTestBlockedError("authorization_cancelled");
  }
  options.signal?.addEventListener("abort", cancel, { once: true });
  authorizationTimer = setTimeout(expire, options.timeoutMs ?? 300_000);
  authorizationTimer.unref();

  return {
    callback,
    boundPort,
    transition: (next) => {
      if (next !== nextActivePhase(phase))
        throw new HostedTestBlockedError("authorization_failed");
      phase = next;
    },
    finish,
    close,
  };
}

function nextActivePhase(
  phase: AuthorizationSessionPhase,
): ActiveAuthorizationSessionPhase | null {
  if (phase === "callback_received") return "exchanging";
  if (phase === "exchanging") return "validating";
  if (phase === "validating") return "committing_grant";
  return null;
}

function isTerminal(phase: AuthorizationSessionPhase): boolean {
  return ["complete", "failed", "expired", "cancelled"].includes(phase);
}

function projectPhase(phase: AuthorizationSessionPhase): CallbackPageOutcome {
  if (phase === "complete") return "complete";
  if (phase === "expired") return "expired";
  if (phase === "failed" || phase === "cancelled") return "failed";
  return "pending";
}

function isExactStatusRequest(
  requestPath: string,
  host: string | undefined,
  statusPath: string,
): boolean {
  if (host !== "127.0.0.1:49671") return false;
  const url = new URL(requestPath, "http://127.0.0.1:49671");
  return (
    url.origin === "http://127.0.0.1:49671" &&
    url.pathname === statusPath &&
    !url.search &&
    !url.hash
  );
}

function redirectToStatus(response: ServerResponse, statusPath: string): void {
  response.writeHead(303, {
    location: statusPath,
    ...securityHeaders(),
  });
  response.end();
}

function writePage(
  response: ServerResponse,
  status: number,
  outcome: CallbackPageOutcome,
): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    ...securityHeaders(),
  });
  response.end(renderCallbackPage(outcome));
}

function securityHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store, max-age=0",
    "content-security-policy":
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function bind(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(new HostedTestBlockedError("authorization_callback_unavailable")),
    );
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new HostedTestBlockedError("authorization_callback_unavailable"),
        );
        return;
      }
      resolve(address.port);
    });
  });
}
