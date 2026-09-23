import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { LocalMcpHostCommand } from "./codex-mcp-config.js";
import { CLI_VERSION } from "./constants.js";

const maxProbeBytes = 1_048_576;
const probeTimeoutMs = 10_000;

export interface InstalledLocalMcpHost extends LocalMcpHostCommand {
  readonly packageRoot: string;
}

export interface LocalMcpHostProbeOptions {
  readonly spawnProcess?: typeof spawn;
  readonly timeoutMs?: number;
}

/** Resolves the fonte-mcp entry owned by the package executing this module. */
export async function locateInstalledLocalMcpHost(
  moduleUrl = import.meta.url,
): Promise<InstalledLocalMcpHost> {
  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    throw new Error("local_mcp_host_unavailable");
  }
  const packageRoot = path.resolve(path.dirname(modulePath), "..");
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    );
  } catch {
    throw new Error("local_mcp_host_unavailable");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error("local_mcp_host_unavailable");
  const record = metadata as {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
  };
  const bins =
    typeof record.bin === "object" && record.bin !== null
      ? (record.bin as Record<string, unknown>)
      : null;
  if (
    record.name !== "@fonte-is/cli" ||
    record.version !== CLI_VERSION ||
    bins?.["fonte-mcp"] !== "./dist/mcp-main.js"
  )
    throw new Error("local_mcp_host_unavailable");
  const expectedRoot = await realpath(packageRoot).catch(() => null);
  const entryPath = path.join(packageRoot, "dist", "mcp-main.js");
  const resolvedEntry = await realpath(entryPath).catch(() => null);
  if (!expectedRoot || !resolvedEntry)
    throw new Error("local_mcp_host_unavailable");
  const relative = path.relative(expectedRoot, resolvedEntry);
  if (relative !== path.join("dist", "mcp-main.js"))
    throw new Error("local_mcp_host_unavailable");
  const entryStat = await lstat(entryPath).catch(() => null);
  if (!entryStat?.isFile()) throw new Error("local_mcp_host_unavailable");
  return {
    packageRoot: expectedRoot,
    command: process.execPath,
    args: [resolvedEntry],
  };
}

/** Starts the package-owned stdio host and proves initialize plus tools/list. */
export async function inspectInstalledLocalMcpHost(
  host: LocalMcpHostCommand,
  options: LocalMcpHostProbeOptions = {},
): Promise<{ readonly initialized: true; readonly tools: readonly string[] }> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const timeoutMs = options.timeoutMs ?? probeTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  const child = spawnProcess(host.command, [...host.args], {
    env: probeEnvironment(),
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  let stdout = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let ended: Error | null = null;
  const failAll = (error: Error) => {
    ended = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat([stdout, chunk]);
    if (stdout.byteLength > maxProbeBytes) {
      failAll(new Error("local_mcp_probe_output_too_large"));
      child.kill("SIGTERM");
      return;
    }
    while (true) {
      const newline = stdout.indexOf(0x0a);
      if (newline < 0) break;
      const line = stdout.subarray(0, newline).toString("utf8").trim();
      stdout = stdout.subarray(newline + 1);
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        failAll(new Error("local_mcp_probe_protocol_invalid"));
        child.kill("SIGTERM");
        return;
      }
      if (!isRecord(message) || typeof message.id !== "number") continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if ("error" in message) {
        request.reject(new Error("local_mcp_probe_request_failed"));
      } else {
        request.resolve(message.result);
      }
    }
  });
  child.once("error", () => failAll(new Error("local_mcp_host_unavailable")));
  child.stdin.on("error", () =>
    failAll(new Error("local_mcp_host_unavailable")),
  );
  child.once("exit", () => {
    if (pending.size > 0) failAll(new Error("local_mcp_host_unavailable"));
  });

  const request = (method: string, params: unknown): Promise<unknown> => {
    if (ended) return Promise.reject(ended);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      child.kill("SIGTERM");
      return Promise.reject(new Error("local_mcp_host_unavailable"));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("local_mcp_host_unavailable"));
        child.kill("SIGTERM");
      }, remaining);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        "utf8",
        (error) => {
          if (!error) return;
          const waiting = pending.get(id);
          pending.delete(id);
          waiting?.reject(new Error("local_mcp_host_unavailable"));
        },
      );
    });
  };

  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "fonte-setup", version: "1" },
    });
    if (
      !isRecord(initialized) ||
      typeof initialized.protocolVersion !== "string"
    )
      throw new Error("local_mcp_host_unavailable");
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      "utf8",
    );
    const tools: string[] = [];
    const seenTools = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const value = await request("tools/list", cursor ? { cursor } : {});
      if (!isRecord(value) || !Array.isArray(value.tools))
        throw new Error("local_mcp_host_unavailable");
      for (const item of value.tools) {
        if (
          !isRecord(item) ||
          typeof item.name !== "string" ||
          item.name.length === 0 ||
          item.name.length > 128 ||
          seenTools.has(item.name) ||
          tools.length >= 500
        )
          throw new Error("local_mcp_host_unavailable");
        seenTools.add(item.name);
        tools.push(item.name);
      }
      if (
        typeof value.nextCursor !== "string" ||
        value.nextCursor.length === 0
      ) {
        child.kill("SIGTERM");
        return { initialized: true, tools };
      }
      if (value.nextCursor.length > 2_048)
        throw new Error("local_mcp_host_unavailable");
      cursor = value.nextCursor;
    }
    throw new Error("local_mcp_host_unavailable");
  } finally {
    child.kill("SIGTERM");
    for (const request of pending.values())
      request.reject(new Error("local_mcp_host_unavailable"));
    pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function probeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { FONTE_NONINTERACTIVE: "1" };
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "XDG_DATA_HOME",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TEMP",
    "TMP",
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
