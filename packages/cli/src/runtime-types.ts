import type { AnyCliReceipt } from "./types.js";
import type { HostedConfig } from "./hosted-config.js";
import type { OperatorDependencies } from "./operator-run.js";
import type { AuthCommandDependencies } from "./auth-commands.js";
import type { FonteSetupDependencies } from "./local-setup.js";

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

export interface CapturedCommandRunner {
  run(
    command: string,
    args: readonly string[],
    cwd: string,
    output?: CommandOutput,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** Streamed channels are consumed immediately rather than replayed in the result. */
export interface CommandOutput {
  stdout?(chunk: string): void;
  stderr?(chunk: string): void;
}

export interface ProgramDependencies {
  cwd: string;
  randomUUID(): string;
  runner: CommandRunner;
  releaseRunner?: CapturedCommandRunner;
  authExec?: AuthorizedConsumerDependencies;
  auth?: AuthCommandDependencies;
  operator?: OperatorDependencies;
  hosted?: HostedTestDependencies;
  setup?: FonteSetupDependencies;
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
  credentialPersisted?(): boolean | null;
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
