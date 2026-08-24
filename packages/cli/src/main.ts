#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import { runProgram } from "./program.js";
import { spawnAuthorizedConsumer } from "./authorized-consumer.js";
import {
  authorizeWithBrowser,
  createBrowserAuthorizationSession,
} from "./oauth.js";
import { systemRunner } from "./runner.js";
import { openBrowser } from "./browser.js";

const cancellation = new AbortController();
const cancel = () => cancellation.abort();
const authExecInvocation =
  process.argv[2] === "auth" && process.argv[3] === "exec";
const broadcastCanaryInvocation =
  process.argv[2] === "broadcast" && process.argv[3] === "canary";
const audienceAppendInvocation =
  process.argv[2] === "broadcast" &&
  process.argv[3] === "audience" &&
  process.argv[4] === "append";
const refreshOperatorInvocation =
  broadcastCanaryInvocation || audienceAppendInvocation;
const operatorAuthorization = refreshOperatorInvocation
  ? createBrowserAuthorizationSession()
  : null;
const authorizeOnce = (
  config: Parameters<typeof authorizeWithBrowser>[0],
  signal?: AbortSignal,
) => authorizeWithBrowser(config, { signal });
if (authExecInvocation || refreshOperatorInvocation) {
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
}
const result = await runProgram(process.argv.slice(2), {
  cwd: process.cwd(),
  randomUUID,
  runner: systemRunner,
  authExec: {
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: authorizeOnce,
    spawn: spawnAuthorizedConsumer,
    signal: cancellation.signal,
  },
  operator: {
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    ...(operatorAuthorization
      ? {
          authorize: operatorAuthorization.authorize,
          renewAuthorization: (
            config: Parameters<typeof authorizeWithBrowser>[0],
            signal?: AbortSignal,
            force = false,
          ) =>
            force
              ? operatorAuthorization.refresh(config, signal)
              : operatorAuthorization.authorize(config, signal),
        }
      : { authorize: authorizeOnce }),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    openUrl: openBrowser,
    signal: cancellation.signal,
  },
  hosted: {
    fetch: globalThis.fetch,
    authorize: (config) => authorizeWithBrowser(config),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
}).finally(() => {
  if (authExecInvocation || refreshOperatorInvocation) {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
