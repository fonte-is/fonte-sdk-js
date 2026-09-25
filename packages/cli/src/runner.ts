import { spawn } from "node:child_process";

import type { CapturedCommandRunner, CommandRunner } from "./runtime-types.js";

export const systemRunner: CommandRunner = {
  run(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd,
        env: process.env,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  },
};

export const releaseRunner: CapturedCommandRunner = {
  run(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
  },
};
