import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { LocalMcpHostCommand } from "./codex-mcp-config.js";
import { CLI_VERSION } from "./constants.js";

const launchAgentLabel = "is.fonte.cli-local-mcp";
const launchAgentFile = "is.fonte.cli-local-mcp.plist";

export interface TrustedMcpLaunchAgentOptions {
  readonly host: LocalMcpHostCommand;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly home?: string;
  readonly uid?: number;
  readonly launchctl?: (args: readonly string[]) => Promise<void>;
}

/** Installs and starts the trusted host only for the first macOS arm64 cut. */
export async function ensureTrustedMcpLaunchAgent(
  options: TrustedMcpLaunchAgentOptions,
): Promise<void> {
  if (
    (options.platform ?? process.platform) !== "darwin" ||
    (options.arch ?? process.arch) !== "arm64"
  )
    return;

  const uid = options.uid ?? process.getuid?.();
  const home = path.resolve(options.home ?? homedir());
  if (!Number.isSafeInteger(uid) || uid === undefined || !path.isAbsolute(home))
    throw new Error("local_mcp_host_unavailable");
  const launchAgents = path.join(home, "Library", "LaunchAgents");
  const plistPath = path.join(launchAgents, launchAgentFile);
  const domain = `gui/${uid}`;
  const service = `${domain}/${launchAgentLabel}`;
  const desired = launchAgentPlist(options.host, home);
  await ensureLaunchAgentsDirectory(launchAgents, uid);

  const loaded = await launchctlPrint(service, options.launchctl);
  const previous = await readOwnedPlist(plistPath, uid);
  const changed = previous !== desired;
  if (loaded && changed) {
    await runLaunchctl(["bootout", domain, plistPath], options.launchctl);
  }
  if (changed) await writeOwnedPlist(plistPath, desired, uid);
  if (!loaded || changed) {
    await runLaunchctl(["bootstrap", domain, plistPath], options.launchctl);
  }
  await runLaunchctl(["kickstart", service], options.launchctl);
}

function launchAgentPlist(host: LocalMcpHostCommand, home: string): string {
  const args = [host.command, ...host.args]
    .map((argument) => `<string>${xml(argument)}</string>`)
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${launchAgentLabel}</string>`,
    `<key>ProgramArguments</key><array>${args}</array>`,
    "<key>RunAtLoad</key><true/>",
    "<key>KeepAlive</key><true/>",
    "<key>ThrottleInterval</key><integer>2</integer>",
    "<key>StandardOutPath</key><string>/dev/null</string>",
    "<key>StandardErrorPath</key><string>/dev/null</string>",
    "<key>EnvironmentVariables</key><dict>",
    `<key>HOME</key><string>${xml(home)}</string>`,
    "<key>FONTE_NONINTERACTIVE</key><string>1</string>",
    `<key>FONTE_TRUSTED_MCP_HOST_VERSION</key><string>${CLI_VERSION}</string>`,
    "</dict>",
    "</dict></plist>\n",
  ].join("");
}

async function ensureLaunchAgentsDirectory(
  directory: string,
  uid: number,
): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o755 });
  } catch {
    throw new Error("local_mcp_host_unavailable");
  }
  const stat = await lstat(directory, { bigint: true }).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid))
    throw new Error("local_mcp_host_unavailable");
}

async function readOwnedPlist(
  file: string,
  uid: number,
): Promise<string | null> {
  const stat = await lstat(file, { bigint: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("local_mcp_host_unavailable");
  });
  if (!stat) return null;
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== BigInt(uid) ||
    (Number(stat.mode) & 0o077) !== 0
  )
    throw new Error("local_mcp_host_unavailable");
  return readFile(file, "utf8").catch(() => {
    throw new Error("local_mcp_host_unavailable");
  });
}

async function writeOwnedPlist(
  file: string,
  value: string,
  uid: number,
): Promise<void> {
  const current = await lstat(file, { bigint: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("local_mcp_host_unavailable");
  });
  if (
    current &&
    (!current.isFile() ||
      current.isSymbolicLink() ||
      current.uid !== BigInt(uid))
  )
    throw new Error("local_mcp_host_unavailable");

  const temporary = `${file}.fonte-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.chmod(0o600);
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
    await chmod(file, 0o600);
    const written = await lstat(file, { bigint: true });
    if (
      !written.isFile() ||
      written.isSymbolicLink() ||
      written.uid !== BigInt(uid) ||
      (Number(written.mode) & 0o077) !== 0
    )
      throw new Error("local_mcp_host_unavailable");
  } catch {
    throw new Error("local_mcp_host_unavailable");
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function launchctlPrint(
  service: string,
  launchctl?: TrustedMcpLaunchAgentOptions["launchctl"],
): Promise<boolean> {
  try {
    await runLaunchctl(["print", service], launchctl);
    return true;
  } catch {
    return false;
  }
}

async function runLaunchctl(
  args: readonly string[],
  launchctl?: TrustedMcpLaunchAgentOptions["launchctl"],
): Promise<void> {
  if (launchctl) return launchctl(args);
  const result = spawnSync("/bin/launchctl", [...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 16_384,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0)
    throw new Error("local_mcp_host_unavailable");
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
