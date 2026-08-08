export class FonteApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(input: {
    status: number;
    code: string;
    path: string;
    operation?: "read" | "write";
  }) {
    super(
      `fonte_api_${input.operation === "read" ? "read" : "write"}_failed:${input.path}:${input.status}:${input.code}`,
    );
    this.name = "FonteApiError";
    this.status = input.status;
    this.code = input.code;
  }
}

export const diagnosticCode = (
  body: Record<string, unknown> | null,
): string => {
  const values = [
    body?.blocked === true ? "blocked" : "",
    body?.error,
    body?.code,
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((value) => value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 160));
  return values.join(":") || "unknown";
};
