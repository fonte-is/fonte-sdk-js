import { createServer, type Server } from "node:http";
import { HostedTestBlockedError } from "./hosted-errors.js";
import { parseOAuthCallback } from "./oauth-callback.js";

export interface CallbackListener {
  readonly callback: Promise<URL>;
  close(): void;
}

export async function listenForOAuthCallback(
  expectedState: string,
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
      response.end(
        "<!doctype html><title>Fonte CLI</title><p>Authorization received. Return to your terminal.</p>",
      );
      resolveCallback(url);
      server.close();
    } catch (error) {
      response.writeHead(400, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end("Fonte CLI authorization was not accepted.");
      if (
        error instanceof HostedTestBlockedError &&
        error.reason === "authorization_state_invalid"
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
  const timer = setTimeout(() => {
    rejectCallback(new HostedTestBlockedError("authorization_timeout"));
    server.close();
  }, 300_000);
  timer.unref();
  return {
    callback: callback.finally(() => clearTimeout(timer)),
    close: () => {
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
