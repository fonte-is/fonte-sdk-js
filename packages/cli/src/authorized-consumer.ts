import { spawn, type ChildProcess } from "node:child_process";

import { CliExecutionError } from "./errors.js";
import { HostedTestBlockedError } from "./hosted-errors.js";

export const AUTHORIZED_BEARER_ENV = "FONTE_HUMAN_BEARER";

const gracefulTerminationMs = 250;
const processGroupPollMs = 10;

type ChildOutcome =
  | { readonly kind: "closed"; readonly code: number | null }
  | { readonly kind: "error" };

export async function spawnAuthorizedConsumer(
  command: string,
  args: readonly string[],
  bearer: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw cancelled();
  let child: ChildProcess;
  try {
    child = spawn(command, [...args], {
      detached: process.platform !== "win32",
      env: { ...process.env, [AUTHORIZED_BEARER_ENV]: bearer },
      shell: false,
      stdio: "inherit",
    });
  } catch {
    throw executionFailed();
  }

  const closed = childOutcome(child);
  const cancellation = cancellationOutcome(signal);
  try {
    const outcome = await Promise.race([closed, cancellation.promise]);
    if (outcome.kind === "cancelled") {
      await terminateConsumerTree(child, closed);
      throw cancelled();
    }
    if (outcome.kind === "error" || outcome.code !== 0) {
      throw executionFailed();
    }
  } finally {
    cancellation.remove();
  }
}

function childOutcome(child: ChildProcess): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ChildOutcome) => {
      if (settled) return;
      settled = true;
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      resolve(outcome);
    };
    const onError = () => finish({ kind: "error" });
    const onClose = (code: number | null) => finish({ kind: "closed", code });
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function cancellationOutcome(signal: AbortSignal | undefined): {
  readonly promise: Promise<{ readonly kind: "cancelled" }>;
  remove(): void;
} {
  let cancel: () => void = () => {};
  const promise = new Promise<{ readonly kind: "cancelled" }>((resolve) => {
    cancel = () => resolve({ kind: "cancelled" });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
  return {
    promise,
    remove: () => signal?.removeEventListener("abort", cancel),
  };
}

async function terminateConsumerTree(
  child: ChildProcess,
  closed: Promise<ChildOutcome>,
): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    await closed;
    return;
  }
  if (process.platform === "win32") {
    await terminateWindowsTree(pid, false);
    if (!(await closesWithin(closed, gracefulTerminationMs))) {
      await terminateWindowsTree(pid, true);
    }
    await closed;
    return;
  }

  signalProcessGroup(pid, "SIGTERM");
  if (!(await processGroupExitsWithin(pid, gracefulTerminationMs))) {
    signalProcessGroup(pid, "SIGKILL");
    await Promise.all([closed, waitForProcessGroupExit(pid)]);
    return;
  }
  await closed;
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function processGroupExitsWithin(
  pid: number,
  milliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (processGroupExists(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(processGroupPollMs, remaining));
  }
  return true;
}

async function waitForProcessGroupExit(pid: number): Promise<void> {
  while (processGroupExists(pid)) await delay(processGroupPollMs);
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function closesWithin(
  closed: Promise<ChildOutcome>,
  milliseconds: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    closed.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function terminateWindowsTree(
  pid: number,
  force: boolean,
): Promise<void> {
  const result = await childOutcome(
    spawn("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
      shell: false,
      stdio: "ignore",
    }),
  );
  if (result.kind === "error") throw executionFailed();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cancelled(): HostedTestBlockedError {
  return new HostedTestBlockedError("authorization_cancelled");
}

function executionFailed(): CliExecutionError {
  return new CliExecutionError("execution_failed");
}
