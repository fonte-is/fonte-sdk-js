import { createServer, type Server } from "node:http";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { renderCallbackPage } from "./loopback-callback-page.js";
import { parseOAuthCallback } from "./oauth-callback.js";

export interface CallbackListener {
  readonly callback: Promise<URL>;
  close(): void;
}

export interface CallbackListenerOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

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
  const server = createServer((request, response) => {
    try {
      if (request.method !== "GET")
        throw new HostedTestBlockedError("authorization_callback_invalid");
      const url = parseOAuthCallback(
        request.url ?? "",
        request.headers.host,
        expectedState,
      );
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderCallbackPage("success"));
      resolveCallback(url);
      server.close();
    } catch (error) {
      response.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderCallbackPage("failure"));
      if (
        error instanceof HostedTestBlockedError &&
        (error.reason === "authorization_callback_invalid" ||
          error.reason === "authorization_state_invalid")
      )
        return;
      rejectCallback(
        error instanceof Error
          ? error
          : new Error("authorization_callback_invalid"),
      );
      server.close();
    }
  });
  await bind(server);
  if (options.signal?.aborted) {
    server.close();
    throw new HostedTestBlockedError("authorization_cancelled");
  }
  let settled = false;
  const rejectOnce = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectCallback(error);
    server.close();
  };
  const cancel = () =>
    rejectOnce(new HostedTestBlockedError("authorization_cancelled"));
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    rejectOnce(new HostedTestBlockedError("authorization_timeout"));
  }, options.timeoutMs ?? 300_000);
  timer.unref();
  const cleanup = () => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  };
  return {
    callback: callback.finally(cleanup),
    close: () => {
      cleanup();
      if (server.listening) server.close();
    },
  };
}

function bind(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(new HostedTestBlockedError("authorization_callback_unavailable")),
    );
    server.listen(49671, "127.0.0.1", () => resolve());
  });
}
