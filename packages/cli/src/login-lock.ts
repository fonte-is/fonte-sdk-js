import { createServer, type Server } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { HostedTestBlockedError } from "./hosted-errors.js";

/** A socket reservation shared by installations; it carries no client protocol. */
export class LoopbackLoginLock {
  constructor(
    private readonly port: number,
    private readonly waitMs = 30_000,
    private readonly retryMs = 50,
  ) {}

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (
      !Number.isInteger(this.port) ||
      this.port < 1 ||
      this.port > 65_535 ||
      !Number.isFinite(this.waitMs) ||
      this.waitMs < 0 ||
      !Number.isFinite(this.retryMs) ||
      this.retryMs <= 0
    ) {
      throw busy();
    }
    const deadline = performance.now() + this.waitMs;
    let server: Server;
    for (;;) {
      if (signal?.aborted) throw busy();
      try {
        server = await reserve(this.port, signal);
        break;
      } catch (error) {
        const remaining = deadline - performance.now();
        if (!addressInUse(error) || remaining <= 0 || signal?.aborted) {
          throw busy();
        }
        try {
          await delay(Math.min(this.retryMs, remaining), undefined, { signal });
        } catch {
          throw busy();
        }
      }
    }
    try {
      if (signal?.aborted) throw busy();
      // Aborting acquisition must never release a lock while its operation
      // still runs. The owner keeps it through refresh, storage, and logout.
      return await operation();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

const processLoginLock = new LoopbackLoginLock(49_672);

export function withLoginLock<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return processLoginLock.run(operation, signal);
}

function reserve(port: number, signal?: AbortSignal): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      // No data is accepted or sent; unsolicited connections cannot hold close.
      socket.on("error", () => {});
      socket.destroy();
    });
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) {
        // close also cancels a pending listen; a failed listen has no handle.
        server.close();
        reject(error);
      } else {
        resolve(server);
      }
    };
    const failed = (error: Error) => finish(error);
    const abort = () => finish(busy());
    server.on("error", failed);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        if (settled) server.close();
        else finish();
      });
    } catch (error) {
      finish(error);
    }
  });
}

function addressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EADDRINUSE"
  );
}

function busy(): HostedTestBlockedError {
  return new HostedTestBlockedError("login_busy");
}
