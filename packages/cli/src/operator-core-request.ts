import { coreError } from "./operator-json.js";

export interface CoreRequestOptions {
  readonly coreApiBaseUrl: string;
  readonly bearer: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface CorePostOptions {
  readonly idempotencyKey?: string;
  readonly body: Record<string, unknown>;
  readonly lostResponseEffect: "none" | "unknown";
  readonly timeoutMs?: number;
}

export type CoreRequester = (
  path: string,
  post?: CorePostOptions,
) => Promise<unknown>;

export class CoreOperatorError extends Error {
  constructor(
    readonly reason: string,
    readonly statusCode: number | null,
    readonly coreEffect: "none" | "unknown",
  ) {
    super(reason);
    this.name = "CoreOperatorError";
  }
}

export function createCoreRequester(
  options: CoreRequestOptions,
): CoreRequester {
  const baseUrl = validatedBaseUrl(options.coreApiBaseUrl);
  const bearer = options.bearer.trim();
  if (!bearer || /\s/.test(bearer)) {
    throw new CoreOperatorError("authorization_token_missing", null, "none");
  }
  return async (path, post) => {
    if (options.signal?.aborted) {
      throw new CoreOperatorError("operation_cancelled", null, "none");
    }
    const timeoutMs = requestTimeoutMs(post?.timeoutMs);
    let response: Response;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method: post ? "POST" : "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${bearer}`,
          ...(post
            ? {
                "content-type": "application/json",
                ...(post.idempotencyKey
                  ? { "idempotency-key": post.idempotencyKey }
                  : {}),
              }
            : {}),
        },
        ...(post ? { body: JSON.stringify(post.body) } : {}),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (options.signal?.aborted) {
        throw new CoreOperatorError("operation_cancelled", null, "none");
      }
      throw new CoreOperatorError(
        "core_api_unavailable",
        null,
        post?.lostResponseEffect ?? "none",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = coreError(body, response.status);
      throw new CoreOperatorError(
        reason,
        response.status,
        failureEffect(post, response.status, reason),
      );
    }
    return body;
  };
}

function requestTimeoutMs(value: number | undefined): number {
  if (value === undefined) return 15_000;
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new CoreOperatorError("core_request_timeout_invalid", null, "none");
  }
  return value;
}

export function parseCoreReceipt<T>(
  parser: (value: unknown) => T,
  value: unknown,
  coreEffect: "none" | "unknown" = "none",
): T {
  try {
    return parser(value);
  } catch {
    throw new CoreOperatorError(
      "core_operator_receipt_invalid",
      null,
      coreEffect,
    );
  }
}

function failureEffect(
  post: CorePostOptions | undefined,
  status: number,
  reason: string,
): "none" | "unknown" {
  if (post?.lostResponseEffect !== "unknown" || status < 500) return "none";
  if (
    reason === "resend_bridge_unavailable" ||
    reason === "resend_bridge_provider_unavailable" ||
    reason === "provider_oauth_unavailable"
  ) {
    return "none";
  }
  return "unknown";
}

function validatedBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new CoreOperatorError("core_api_base_url_invalid", null, "none");
  }
  return url.toString().replace(/\/$/, "");
}
