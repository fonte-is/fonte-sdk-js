import { spawn } from "node:child_process";

import type { CommandRunner } from "./runtime-types.js";

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
