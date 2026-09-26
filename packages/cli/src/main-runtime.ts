#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { runProgram } from "./program.js";
import { spawnAuthorizedConsumer } from "./authorized-consumer.js";
import { createClientAuthRuntime } from "./client-auth-runtime.js";
import { withLoginLock } from "./login-lock.js";
import { releaseRunner, systemRunner } from "./runner.js";
import { openBrowser } from "./browser.js";
import { createDurableFonteMcpSession } from "./mcp-sequence-server.js";
import { createLocalFonteSetupDependencies } from "./local-readiness-adapter.js";

const cancellation = new AbortController();
const cancel = () => cancellation.abort();
const handleSignals =
  process.argv[2] === "auth" ||
  (process.argv[2] === "broadcast" &&
    (process.argv[3] === "canary" ||
      process.argv[3] === "send" ||
      (process.argv[3] === "audience" && process.argv[4] === "append")));
if (handleSignals) {
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
}
const login = createClientAuthRuntime({
  fetch: globalThis.fetch,
  configUrl: process.env.FONTE_CLI_CONFIG_URL,
  chooseFileStore: async () => {
    if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const answer = await prompt.question(
        "Native credential storage is unavailable in this process. Use the per-user Fonte session file instead? Its permissions protect it from other OS users, not other processes running as you. [y/N] ",
      );
      return /^(y|yes)$/i.test(answer.trim());
    } finally {
      prompt.close();
    }
  },
  withLock: async (operation, signal) => {
    if (!handleSignals) {
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
    }
    try {
      return await withLoginLock(operation, signal);
    } finally {
      if (!handleSignals) {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    }
  },
});
const result = await runProgram(process.argv.slice(2), {
  cwd: process.cwd(),
  randomUUID,
  runner: systemRunner,
  releaseRunner,
  auth: {
    session: login,
    signal: cancellation.signal,
  },
  authExec: {
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: login.authorize,
    spawn: spawnAuthorizedConsumer,
    signal: cancellation.signal,
  },
  operator: {
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: login.authorize,
    renewAuthorization: login.renewAuthorization,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    readProviderEvidenceCandidateFile: (path) => readFile(path, "utf8"),
    readProviderPlacementApplicationFile: (path) => readFile(path, "utf8"),
    openUrl: openBrowser,
    signal: cancellation.signal,
  },
  hosted: {
    fetch: globalThis.fetch,
    authorize: (config) => login.authorize(config, cancellation.signal),
    credentialPersisted: login.credentialPersisted,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
  setup: createLocalFonteSetupDependencies({
    auth: login,
    workspaceCatalog: createDurableFonteMcpSession({
      configUrl: process.env.FONTE_CLI_CONFIG_URL,
      fetch: globalThis.fetch,
      authorize: login.authorize,
      renewAuthorization: login.renewAuthorization,
      signal: cancellation.signal,
    }).workspaceCatalog,
    signal: cancellation.signal,
  }),
}).finally(() => {
  if (handleSignals) {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
