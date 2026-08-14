import type { CliReceipt } from "./types.js";

export interface ProjectProfile {
  root: string;
  app_directory: "app" | "src/app";
  package_manager: "npm";
  package_manifest: Record<string, unknown>;
  scripts: Record<string, string>;
}

export interface CommandResult {
  exitCode: 0 | 1 | 2 | 3;
  stdout: string;
  stderr: string;
  receipt?: CliReceipt;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<number>;
}

export interface ProgramDependencies {
  cwd: string;
  randomUUID(): string;
  runner: CommandRunner;
}

export interface FileSnapshot {
  path: string;
  existed: boolean;
  bytes?: Uint8Array;
  mode?: number;
}

export type DependencyPosture = "absent" | "exact";

export interface IgnorePosture {
  ignored: boolean;
  owned: boolean;
}
