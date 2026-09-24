#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliMain = path.join(root, "packages", "cli", "dist", "main.js");
const mcpMain = path.join(
  root,
  "packages",
  "cli",
  "dist",
  "mcp-client-main.js",
);
const node = process.execPath;
const sandboxExec = "/usr/bin/sandbox-exec";
const home = homedir();
const uid = process.getuid?.();
const safeEnv = {
  HOME: home,
  PATH: "/opt/homebrew/bin:/usr/bin:/bin",
  FONTE_NONINTERACTIVE: "1",
};
const usedExecutables = [];

try {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.ok(Number.isSafeInteger(uid));
  assert.ok(existsSync(cliMain) && existsSync(mcpMain));
  assert.ok(existsSync(sandboxExec));
  assertNoCredentialFields(safeEnv);

  const { userDataDirectory } = await import(
    pathToFileURL(
      path.join(
        root,
        "packages",
        "cli",
        "dist",
        "credential-store",
        "user-private-file-store.js",
      ),
    ).href
  );
  const credentialDirectory = userDataDirectory({ platform: "darwin", home });
  const credentialStat = await lstat(credentialDirectory).catch(() => null);
  if (!credentialStat?.isDirectory())
    throw new Error("credential_directory_missing");

  const status = await cliJson("auth", "status", "--json");
  if (
    status.outcome !== "completed" ||
    status.state !== "signed_in_local" ||
    status.storage?.backend !== "user_private_file" ||
    status.storage?.status !== "available"
  )
    throw new Error("normal_shell_session_not_ready");

  const profile = [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath "${seatbeltPath(credentialDirectory)}"))`,
    `(deny file-write* (subpath "${seatbeltPath(credentialDirectory)}"))`,
  ].join(" ");
  const denied = await checkCredentialDirectoryDenied(
    profile,
    credentialDirectory,
  );
  if (!denied) throw new Error("sandbox_can_read_credential_directory");

  const setup = await cliJson("setup", "--json");
  if (
    !["ready", "workspace_required"].includes(setup.state) ||
    setup.authentication !== "ready"
  )
    throw new Error("fonte_setup_not_ready");

  await assertSocketBoundary();
  const firstClients = await fiveClients(profile);
  if (!firstClients) throw new Error("five_sandbox_clients_failed");
  const restartedClients = await fiveClients(profile);
  if (!restartedClients) throw new Error("sandbox_client_restart_failed");

  await restartTrustedHost();
  if (!(await oneClient(profile)))
    throw new Error("trusted_host_restart_failed");

  await restartTrustedHost();
  if (!(await oneClient(profile))) throw new Error("token_renewal_failed");

  const logout = await cliJson("auth", "logout", "--json");
  if (
    logout.outcome !== "completed" ||
    !["cleared", "already_signed_out"].includes(logout.local_logout)
  )
    throw new Error("local_logout_failed");
  if (await oneClient(profile)) throw new Error("logout_did_not_fence_client");

  if (usedExecutables.some((command) => /(^|\/)open(?:\.app)?$/i.test(command)))
    throw new Error("unexpected_browser_open");

  process.stdout.write("CREDENTIAL_DIRECTORY_READ=denied\n");
  process.stdout.write("SANDBOX_CLIENTS=5/5\n");
  process.stdout.write("CLIENT_RESTART=pass\n");
  process.stdout.write("TRUSTED_HOST_RESTART=pass\n");
  process.stdout.write("TOKEN_RENEWAL=pass\n");
  process.stdout.write("LOGOUT_FENCING=pass\n");
  process.stdout.write("BROWSER_LOGINS=0\n");
  process.stdout.write("CREDENTIAL_EXPOSURE=none\n");
} catch (error) {
  process.stderr.write(`PROOF_BLOCKER=${proofReason(error)}\n`);
  process.exitCode = 1;
}

async function cliJson(...args) {
  const result = await run(node, [cliMain, ...args], safeEnv);
  const receipt = parseJson(result.stdout);
  assertNoCredentialFields(result.stdout);
  assertNoCredentialFields(result.stderr);
  if (args[0] !== "setup" && result.exitCode !== 0)
    throw new Error(receipt.reason ?? "cli_command_failed");
  if (args[0] === "setup" && ![0, 3].includes(result.exitCode))
    throw new Error("fonte_setup_failed");
  return receipt;
}

async function checkCredentialDirectoryDenied(profile, directory) {
  const probe = [
    "-e",
    'try { require("node:fs").readdirSync(process.argv[1]); process.exitCode = 0; } catch (error) { process.exitCode = ["EACCES", "EPERM"].includes(error.code) ? 2 : 3; }',
    directory,
  ];
  const result = await run(
    sandboxExec,
    ["-p", profile, node, ...probe],
    safeEnv,
  );
  assertNoCredentialFields(result.stdout);
  assertNoCredentialFields(result.stderr);
  return result.exitCode === 2;
}

async function assertSocketBoundary() {
  const { trustedMcpSocketPath } = await import(
    pathToFileURL(
      path.join(root, "packages", "cli", "dist", "trusted-mcp-ipc.js"),
    ).href
  );
  const socketPath = trustedMcpSocketPath(uid);
  const socket = await lstat(socketPath, { bigint: true });
  const directory = await lstat(path.dirname(socketPath), { bigint: true });
  assert.ok(socket.isSocket() && socket.uid === BigInt(uid));
  assert.equal(Number(socket.mode) & 0o777, 0o600);
  assert.ok(directory.isDirectory() && directory.uid === BigInt(uid));
  assert.equal(Number(directory.mode) & 0o777, 0o700);
}

async function fiveClients(profile) {
  const results = await Promise.all(
    Array.from({ length: 5 }, () => oneClient(profile)),
  );
  return results.every(Boolean);
}

async function oneClient(profile) {
  const args = ["-p", profile, node, mcpMain];
  const child = spawn(sandboxExec, args, {
    env: safeEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  usedExecutables.push(sandboxExec, node);
  const output = [];
  const errors = [];
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const maxOutputBytes = 1_048_576;
  let totalOutput = 0;
  child.stdout.on("data", (chunk) => {
    totalOutput += chunk.length;
    if (totalOutput > maxOutputBytes) {
      child.kill("SIGTERM");
      return;
    }
    output.push(Buffer.from(chunk));
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = buffer.subarray(0, newline).toString("utf8").trim();
      buffer = buffer.subarray(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        child.kill("SIGTERM");
        continue;
      }
      if (Number.isInteger(message?.id)) {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        if (waiting) {
          if (message.error) waiting.reject(new Error("mcp_request_failed"));
          else waiting.resolve(message.result);
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
  child.once("error", () => {
    for (const waiting of pending.values())
      waiting.reject(new Error("sandbox_client_failed"));
    pending.clear();
  });

  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("mcp_request_timeout"));
      }, 15_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        "utf8",
      );
    });
  };

  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "fonte-sandbox-proof", version: "1" },
    });
    if (typeof initialized?.protocolVersion !== "string") return false;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      "utf8",
    );
    const listed = await request("tools/list", {});
    if (
      !Array.isArray(listed?.tools) ||
      !listed.tools.some((tool) => tool.name === "fonte_list_workspaces")
    )
      return false;
    const called = await request("tools/call", {
      name: "fonte_list_workspaces",
      arguments: {},
    });
    if (called?.isError === true) return false;
    const structured =
      called?.structuredContent ?? readStructuredContent(called);
    if (structured?.outcome !== "completed") return false;
    assertNoCredentialFields(Buffer.concat(output).toString("utf8"));
    assertNoCredentialFields(Buffer.concat(errors).toString("utf8"));
    return true;
  } catch {
    assertNoCredentialFields(Buffer.concat(output).toString("utf8"));
    assertNoCredentialFields(Buffer.concat(errors).toString("utf8"));
    return false;
  } finally {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    });
    for (const waiting of pending.values())
      waiting.reject(new Error("sandbox_client_stopped"));
  }
}

async function restartTrustedHost() {
  const service = `gui/${uid}/is.fonte.cli-local-mcp`;
  const result = spawnSync("/bin/launchctl", ["kickstart", "-k", service], {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "ignore", "ignore"],
  });
  usedExecutables.push("/bin/launchctl");
  if (result.error || result.status !== 0)
    throw new Error("trusted_host_restart_failed");
}

function readStructuredContent(response) {
  const text = response?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function run(command, args, env) {
  usedExecutables.push(command);
  assertNoCredentialFields(args);
  assertNoCredentialFields(env);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", () => reject(new Error("proof_command_failed")));
    child.once("close", (exitCode) =>
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("cli_json_invalid");
  }
}

function assertNoCredentialFields(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/iu.test(text) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u.test(
      text,
    ) ||
    /(?:access|refresh)[_-]?token\s*["']?\s*[:=]\s*["'][^"']{16,}["']/iu.test(
      text,
    )
  )
    throw new Error("credential_material_exposed");
}

function seatbeltPath(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function proofReason(error) {
  const name = error instanceof Error ? error.message : "proof_failed";
  return name.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 100);
}
