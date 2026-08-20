import type { AnyCliReceipt } from "./types.js";
import type { HostedConfig } from "./hosted-config.js";
import type { OperatorDependencies } from "./operator-run.js";

export interface ProjectProfile {
  root: string;
  app_directory: "app" | "src/app";
  package_manager: "npm";
  package_lock_present: boolean;
  package_manifest: Record<string, unknown>;
}

export interface CommandResult {
  exitCode: 0 | 1 | 2 | 3;
  stdout: string;
  stderr: string;
  receipt?: AnyCliReceipt;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<number>;
}

export interface ProgramDependencies {
  cwd: string;
  randomUUID(): string;
  runner: CommandRunner;
  authExec?: AuthorizedConsumerDependencies;
  operator?: OperatorDependencies;
  hosted?: HostedTestDependencies;
}

export interface AuthorizedConsumerDependencies {
  readonly configUrl?: string;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  authorize(config: HostedConfig, signal?: AbortSignal): Promise<string>;
  spawn(
    command: string,
    args: readonly string[],
    bearer: string,
    signal?: AbortSignal,
  ): Promise<void>;
  signal?: AbortSignal;
}

export interface HostedTestDependencies {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  authorize(config: HostedConfig): Promise<string>;
  sleep(milliseconds: number): Promise<void>;
}

export interface FileSnapshot {
  path: string;
  existed: boolean;
  bytes?: Uint8Array;
  mode?: number;
  device?: bigint;
  inode?: bigint;
}

export type DependencyPosture = "absent" | "exact";

export interface IgnorePosture {
  ignored: boolean;
  owned: boolean;
}
