#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import { runProgram } from "./program.js";
import { authorizeWithBrowser } from "./oauth.js";
import { systemRunner } from "./runner.js";

const result = await runProgram(process.argv.slice(2), {
  cwd: process.cwd(),
  randomUUID,
  runner: systemRunner,
  hosted: {
    fetch: globalThis.fetch,
    authorize: authorizeWithBrowser,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
