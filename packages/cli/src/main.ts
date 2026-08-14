#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import { runProgram } from "./program.js";
import { systemRunner } from "./runner.js";

const result = await runProgram(process.argv.slice(2), {
  cwd: process.cwd(),
  randomUUID,
  runner: systemRunner,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
