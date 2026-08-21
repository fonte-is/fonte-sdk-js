import type { BlockReason } from "./types.js";

export type InvocationDetailKind =
  "missing_field" | "invalid_field" | "duplicate_field" | "unknown_field";

export interface InvocationErrorDetail {
  readonly kind: InvocationDetailKind;
  readonly field: string;
}

export class CliUsageError extends Error {
  readonly exitCode = 2 as const;

  constructor(
    readonly code: string,
    readonly detail: InvocationErrorDetail = {
      kind: "invalid_field",
      field: "invocation",
    },
  ) {
    super(code);
  }
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
