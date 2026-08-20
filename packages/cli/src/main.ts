#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import { runProgram } from "./program.js";
import { spawnAuthorizedConsumer } from "./authorized-consumer.js";
import { authorizeWithBrowser } from "./oauth.js";
import { systemRunner } from "./runner.js";

const cancellation = new AbortController();
const cancel = () => cancellation.abort();
const authExecInvocation =
  process.argv[2] === "auth" && process.argv[3] === "exec";
if (authExecInvocation) {
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
    authorize: (config, signal) => authorizeWithBrowser(config, { signal }),
    spawn: spawnAuthorizedConsumer,
    signal: cancellation.signal,
  },
  operator: {
    configUrl: process.env.FONTE_CLI_CONFIG_URL,
    fetch: globalThis.fetch,
    authorize: authorizeWithBrowser,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
  hosted: {
    fetch: globalThis.fetch,
    authorize: authorizeWithBrowser,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
}).finally(() => {
  if (authExecInvocation) {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
