import type { BlockReason } from "./types.js";

export type InvocationDetailKind =
  "missing_field" | "invalid_field" | "duplicate_field" | "unknown_field";

export interface InvocationErrorDetail {
  readonly kind: InvocationDetailKind;
  readonly field: string;
}

const admittedFields = new Set([
  "--yes",
  "--json",
  "--workspace",
  "--environment",
  "--idempotency-key",
  "--title",
  "--subject",
  "--body",
  "--preheader",
  "--sender-profile-id",
  "--reply-to",
  "--communication-purpose-id",
  "--include-collection",
  "--include-import-batch",
  "--exclude-collection",
  "--exclude-import-batch",
  "--all-contacts",
  "--draft-id",
  "--revision",
  "--postal-address",
  "--test-id",
  "--acknowledge-audience-reuse",
  "--broadcast-id",
  "--watch",
  "--expected-version",
  "--segment-id",
  "--fingerprint",
  "--declare-marketing-permission",
]);

function boundedInvocationField(field: string): string {
  if (field === "command" || field === "auth exec") return field;
  return admittedFields.has(field) ? field : "invocation";
}

export class CliUsageError extends Error {
  readonly exitCode = 2 as const;
  readonly detail: InvocationErrorDetail;

  constructor(
    readonly code: string,
    detail: InvocationErrorDetail = {
      kind: "invalid_field",
      field: "invocation",
    },
  ) {
    super(code);
    this.detail = { ...detail, field: boundedInvocationField(detail.field) };
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
