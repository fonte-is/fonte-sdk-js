import type { BlockReason } from "./types.js";

export class CliUsageError extends Error {
  readonly exitCode = 2 as const;
}

export class CliBlockedError extends Error {
  readonly exitCode = 3 as const;

  constructor(readonly reason: BlockReason) {
    super(reason);
  }
}

export class CliExecutionError extends Error {
  readonly exitCode = 1 as const;

  constructor(readonly reason: "execution_failed" | "rollback_failed") {
    super(reason);
  }
}
