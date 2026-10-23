import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

const maxClients = 16;
const connectTimeoutMs = 10_000;
const retryIntervalMs = 100;

export interface TrustedMcpHostOptions {
  readonly socketPath?: string;
  readonly expectedUid?: number;
  readonly handleClient: (client: Socket) => void | Promise<void>;
}

export interface TrustedMcpClientOptions {
  readonly socketPath?: string;
  readonly expectedUid?: number;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly timeoutMs?: number;
}

/** A stable, per-OS-user rendezvous which contains no authentication material. */
export function trustedMcpSocketPath(uid = process.getuid?.()): string {
  if (!Number.isSafeInteger(uid) || uid === undefined || uid < 0)
    throw new Error("trusted_mcp_boundary_unavailable");
  return path.join("/private/tmp", `fonte-mcp-${uid}`, "mcp.sock");
}

/**
 * Serves clients in the one trusted process. The public socket is confined to
 * a private, current-user-only directory and carries MCP bytes.
 */
export async function startTrustedMcpHost(
  options: TrustedMcpHostOptions,
): Promise<{ readonly socketPath: string; close(): Promise<void> }> {
  const expectedUid = options.expectedUid ?? process.getuid?.();
  if (!Number.isSafeInteger(expectedUid) || expectedUid === undefined)
    throw new Error("trusted_mcp_boundary_unavailable");
  const socketPath = path.resolve(
    options.socketPath ?? trustedMcpSocketPath(expectedUid),
  );
  if (Buffer.byteLength(socketPath, "utf8") >= 100)
    throw new Error("trusted_mcp_boundary_unavailable");

  await ensurePrivateSocketDirectory(path.dirname(socketPath), expectedUid);
  await removeOwnedStaleSocket(socketPath, expectedUid);

  const clients = new Set<Socket>();
  const server: Server = createServer((client) => {
    if (clients.size >= maxClients) {
      client.destroy();
      return;
    }
    clients.add(client);
    client.setNoDelay(true);
    client.once("close", () => clients.delete(client));
    client.on("error", () => client.destroy());
    void Promise.resolve()
      .then(() => options.handleClient(client))
      .catch(() => client.destroy());
  });

  await listen(server, socketPath);
  try {
    await chmod(socketPath, 0o600);
    await assertOwnedPrivateSocket(socketPath, expectedUid);
  } catch {
    await closeServer(server, clients);
    await unlink(socketPath).catch(() => undefined);
    throw new Error("trusted_mcp_boundary_unavailable");
  }
  const created = await lstat(socketPath, { bigint: true });

  return {
    socketPath,
    async close() {
      await closeServer(server, clients);
      const current = await lstat(socketPath, { bigint: true }).catch(
        () => null,
      );
      if (
        current?.isSocket() &&
        current.uid === created.uid &&
        current.dev === created.dev &&
        current.ino === created.ino
      ) {
        await unlink(socketPath).catch(() => undefined);
      }
    },
  };
}

/** Connects a sandbox client to the trusted host without loading auth modules. */
export async function runTrustedMcpClient(
  options: TrustedMcpClientOptions = {},
): Promise<void> {
  const expectedUid = options.expectedUid ?? process.getuid?.();
  if (!Number.isSafeInteger(expectedUid) || expectedUid === undefined)
    throw new Error("local_mcp_host_unavailable");
  const socketPath = path.resolve(
    options.socketPath ?? trustedMcpSocketPath(expectedUid),
  );
  const timeoutMs = options.timeoutMs ?? connectTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let socket: Socket | undefined;

  while (!socket && Date.now() < deadline) {
    try {
      await assertOwnedPrivateSocket(socketPath, expectedUid);
      socket = await connect(socketPath);
    } catch (error) {
      if (!retryableEndpointError(error))
        throw new Error("local_mcp_host_unavailable");
      await delay(
        Math.min(retryIntervalMs, Math.max(1, deadline - Date.now())),
      );
    }
  }
  if (!socket) throw new Error("local_mcp_host_unavailable");

  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      stdin.unpipe(socket);
      socket!.unpipe(stdout);
      socket!.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket!.once("error", () =>
      finish(new Error("local_mcp_host_unavailable")),
    );
    socket!.once("close", () => finish());
    stdin.once("error", () => finish(new Error("local_mcp_host_unavailable")));
    stdout.once("error", () => finish(new Error("local_mcp_host_unavailable")));
    stdin.pipe(socket!);
    socket!.pipe(stdout);
  });
}

async function ensurePrivateSocketDirectory(
  directory: string,
  expectedUid: number,
): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw new Error("trusted_mcp_boundary_unavailable");
  }
  const stat = await lstat(directory, { bigint: true }).catch(() => null);
  if (
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== BigInt(expectedUid)
  )
    throw new Error("trusted_mcp_boundary_unavailable");
  if ((Number(stat.mode) & 0o777) !== 0o700) await chmod(directory, 0o700);
  const verified = await lstat(directory, { bigint: true }).catch(() => null);
  if (
    !verified?.isDirectory() ||
    verified.isSymbolicLink() ||
    verified.uid !== BigInt(expectedUid) ||
    (Number(verified.mode) & 0o777) !== 0o700
  )
    throw new Error("trusted_mcp_boundary_unavailable");
}

async function removeOwnedStaleSocket(
  socketPath: string,
  expectedUid: number,
): Promise<void> {
  const existing = await lstat(socketPath, { bigint: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("trusted_mcp_boundary_unavailable");
  });
  if (!existing) return;
  if (!existing.isSocket() || existing.uid !== BigInt(expectedUid))
    throw new Error("trusted_mcp_boundary_unavailable");

  try {
    const active = await connect(socketPath, 500);
    active.destroy();
    throw new Error("trusted_mcp_host_already_running");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "trusted_mcp_host_already_running"
    )
      throw error;
    if (!staleSocketError(error))
      throw new Error("trusted_mcp_boundary_unavailable");
  }

  const current = await lstat(socketPath, { bigint: true }).catch(() => null);
  if (
    current?.isSocket() &&
    current.uid === existing.uid &&
    current.dev === existing.dev &&
    current.ino === existing.ino
  ) {
    await unlink(socketPath);
  }
}

async function assertOwnedPrivateSocket(
  socketPath: string,
  expectedUid: number,
): Promise<void> {
  const directory = await lstat(path.dirname(socketPath), {
    bigint: true,
  }).catch((error) => {
    throw error;
  });
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== BigInt(expectedUid) ||
    (Number(directory.mode) & 0o777) !== 0o700
  )
    throw new Error("local_mcp_host_unavailable");
  const socket = await lstat(socketPath, { bigint: true });
  if (
    !socket.isSocket() ||
    socket.isSymbolicLink() ||
    socket.uid !== BigInt(expectedUid) ||
    (Number(socket.mode) & 0o777) !== 0o600
  )
    throw new Error("local_mcp_host_unavailable");
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

function connect(
  socketPath: string,
  timeoutMs = connectTimeoutMs,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("local_mcp_connect_timeout"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function retryableEndpointError(error: unknown): boolean {
  return ["ECONNREFUSED", "ENOENT"].includes(
    (error as NodeJS.ErrnoException)?.code ?? "",
  );
}

function staleSocketError(error: unknown): boolean {
  return ["ECONNREFUSED", "ENOENT"].includes(
    (error as NodeJS.ErrnoException)?.code ?? "",
  );
}

async function closeServer(
  server: Server,
  clients: Set<Socket>,
): Promise<void> {
  for (const client of clients) client.destroy();
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
